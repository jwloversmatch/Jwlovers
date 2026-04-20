// config/database.js
"use strict";

const { EventEmitter } = require("events");
const mongoose = require("mongoose");

// FIX #8: Set strictQuery before any mongoose operations.
// Mongoose 6 warns without this; Mongoose 7 silently changed the default.
mongoose.set("strictQuery", false);

const READY_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

// FIX #5: Removed autoIndex / bufferCommands / autoCreate — they are NOT
// configurable (always forced off in _buildMongooseOptions). Keeping them
// here implied they could be overridden, which was misleading.
const DEFAULT_CONFIG = {
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 50,
  minPoolSize: 10,
  socketTimeoutMS: 30000,
  connectTimeoutMS: 10000,
  retryWrites: true,
  retryReads: true,
  ipv4Only: true,
  // Internal retry config — not passed to mongoose
  maxRetries: 5,
  retryDelayMs: 1000,
  retryBackoffFactor: 2,
  // healthCheck ping timeout (ms)
  pingTimeoutMs: 3000,
};

/**
 * DatabaseService
 *
 * Emits:
 *   'connected'    — after a successful connection
 *   'disconnected' — after a clean disconnect() call
 *   'shutdown'     — when SIGINT/SIGTERM is received and DB is closed.
 *                    Listen to this in your HTTP server to drain and exit.
 *
 * Usage:
 *   const db = new DatabaseService(config, logger, { Conversation, Message });
 *   await db.connect();
 *   process.on('shutdown', ({ signal }) => server.close(() => process.exit(0)));
 */
class DatabaseService extends EventEmitter {
  /**
   * @param {object} config  - Overrides for DEFAULT_CONFIG
   * @param {object} logger  - Must implement .info / .warn / .error
   * @param {object} models  - Injected model map: { Conversation, Message }
   */
  constructor(config = {}, logger, models = {}) {
    super();

    if (!logger?.info || !logger?.warn || !logger?.error) {
      throw new Error(
        "DatabaseService requires a logger with .info(), .warn(), and .error() methods"
      );
    }

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
    this.models = models;

    this._indexCreationPromise = null;
    this._shutdownRegistered = false;
    this._listenersAttached = false;
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  async connect() {
    const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/jwlovers";
    this._validateUri(mongoUri);

    const mongooseOptions = this._buildMongooseOptions();
    const { maxRetries, retryDelayMs, retryBackoffFactor } = this.config;

    let attempt = 0;
    let delay = retryDelayMs;

    while (attempt <= maxRetries) {
      try {
        const conn = await mongoose.connect(mongoUri, mongooseOptions);

        this.logger.info(`✅ MongoDB connected: ${conn.connection.host}`);
        this.logger.info(`📊 Database: ${conn.connection.name}`);
        this.logger.info(
          `🔌 Pool: min=${this.config.minPoolSize}, max=${this.config.maxPoolSize}`
        );

        this._setupEventListeners();
        this._registerShutdownHandlers();
        this._ensureIndexesAsync();

        this.emit("connected", { host: conn.connection.host });
        return conn;
      } catch (error) {
        attempt++;
        // FIX #10: Sanitize URI before logging — prevents credentials leaking
        // via mongoose error messages that may embed the connection string.
        const safeMessage = this._sanitizeErrorMessage(error.message, mongoUri);

        if (attempt > maxRetries) {
          this.logger.error(
            `❌ MongoDB connection failed after ${maxRetries} retries: ${safeMessage}`
          );
          throw new Error(safeMessage);
        }

        this.logger.warn(
          `⚠️  MongoDB attempt ${attempt}/${maxRetries} failed — retrying in ${delay}ms... (${safeMessage})`
        );
        await this._sleep(delay);
        delay = Math.min(delay * retryBackoffFactor, 30_000);
      }
    }
  }

  async disconnect() {
    try {
      await mongoose.connection.close();

      // FIX #2: Reset flags so connect() → disconnect() → connect() works correctly.
      // Without this, re-connecting never re-attaches listeners or re-registers
      // shutdown handlers.
      this._indexCreationPromise = null;
      this._listenersAttached = false;
      this._shutdownRegistered = false;

      this.logger.info("🔌 MongoDB disconnected gracefully");
      this.emit("disconnected");
    } catch (error) {
      this.logger.error(`❌ Error during MongoDB disconnect: ${error.message}`);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Readiness
  // ---------------------------------------------------------------------------

  /**
   * Resolves immediately if already connected.
   * Otherwise waits for the 'connected' mongoose event (zero CPU — no polling).
   *
   * FIX #4: Replaced 100ms busy-poll with event-driven wait.
   */
  async waitUntilConnected(timeoutMs = 10_000) {
    if (this.isConnected()) return;

    return new Promise((resolve, reject) => {
      let timer;

      const onConnected = () => {
        clearTimeout(timer);
        mongoose.connection.off("error", onError);
        resolve();
      };

      const onError = (err) => {
        clearTimeout(timer);
        mongoose.connection.off("connected", onConnected);
        reject(new Error(`MongoDB connection error: ${err.message}`));
      };

      timer = setTimeout(() => {
        mongoose.connection.off("connected", onConnected);
        mongoose.connection.off("error", onError);
        reject(
          new Error(
            `MongoDB not ready after ${timeoutMs}ms — state: ${this.getReadyState().state}`
          )
        );
      }, timeoutMs);

      // FIX #3 (partial): Unref the timeout so it doesn't block process exit
      if (timer.unref) timer.unref();

      mongoose.connection.once("connected", onConnected);
      mongoose.connection.once("error", onError);
    });
  }

  // ---------------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------------

  _ensureIndexesAsync() {
    if (this._indexCreationPromise) return this._indexCreationPromise;

    this._indexCreationPromise = (async () => {
      this.logger.info("🔄 Starting background index creation...");
      const results = await Promise.allSettled([
        this._ensureConversationIndexes(),
        this._ensureMessageIndexes(),
      ]);

      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) {
        failed.forEach((r) =>
          this.logger.warn(`⚠️  Index creation error: ${r.reason?.message}`)
        );
      } else {
        this.logger.info("✅ Background index creation completed");
      }
    })();

    // Prevent unhandled rejection — errors are already logged above
    this._indexCreationPromise.catch(() => {});

    return this._indexCreationPromise;
  }

  async _ensureConversationIndexes() {
    const Conversation =
      this.models.Conversation ?? this._requireModel("@models/Conversation");
    if (!Conversation) return;

    const existing = await Conversation.collection.indexes();
    if (existing.some((idx) => idx.name !== "_id_")) {
      this.logger.info("✅ Conversation indexes already exist, skipping");
      return;
    }

    // FIX #6: Promise.allSettled — one failing index no longer aborts the rest
    // FIX #9: Removed deprecated `background: true` (no-op in MongoDB 4.2+, removed in 4.4+)
    const results = await Promise.allSettled([
      Conversation.collection.createIndex({ participants: 1 }),
      Conversation.collection.createIndex({ participants: 1, lastMessageAt: -1 }),
      Conversation.collection.createIndex({ "participants.userId": 1 }),
      Conversation.collection.createIndex({ lastMessageAt: -1 }),
    ]);

    this._logIndexResults("Conversation", results);
  }

  async _ensureMessageIndexes() {
    const Message =
      this.models.Message ?? this._requireModel("@models/Message");
    if (!Message) return;

    const existing = await Message.collection.indexes();
    if (existing.some((idx) => idx.name !== "_id_")) {
      this.logger.info("✅ Message indexes already exist, skipping");
      return;
    }

    // FIX #6: allSettled — partial failures don't abort remaining indexes
    // FIX #9: No background: true (deprecated/removed in MongoDB 4.2+/4.4+)
    const results = await Promise.allSettled([
      Message.collection.createIndex({ conversationId: 1, createdAt: -1 }),
      // Compound covers { senderId, receiverId } queries — no separate index needed
      Message.collection.createIndex({ senderId: 1, receiverId: 1, createdAt: -1 }),
      Message.collection.createIndex({ readBy: 1 }),
      Message.collection.createIndex({ createdAt: -1 }),
    ]);

    this._logIndexResults("Message", results);
  }

  _logIndexResults(collectionName, results) {
    const failed = results.filter((r) => r.status === "rejected");
    const passed = results.filter((r) => r.status === "fulfilled").length;

    if (failed.length) {
      failed.forEach((r) =>
        this.logger.warn(
          `⚠️  ${collectionName} index creation partial failure: ${r.reason?.message}`
        )
      );
    }
    if (passed > 0) {
      this.logger.info(`✅ ${collectionName}: ${passed} index(es) created`);
    }
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  async healthCheck() {
    if (!this.isConnected()) {
      return {
        healthy: false,
        latency: 0,
        state: this.getReadyState().state,
        error: "Not connected",
      };
    }

    const start = Date.now();
    try {
      // FIX #7: maxTimeMS prevents ping from hanging indefinitely on degraded connections
      await mongoose.connection.db.command({
        ping: 1,
        maxTimeMS: this.config.pingTimeoutMs,
      });
      return {
        healthy: true,
        latency: Date.now() - start,
        state: "connected",
        pool: {
          min: this.config.minPoolSize,
          max: this.config.maxPoolSize,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - start,
        state: this.getReadyState().state,
        error: error.message,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  isConnected() {
    return mongoose.connection.readyState === 1;
  }

  getReadyState() {
    const code = mongoose.connection.readyState;
    return {
      state: READY_STATES[code] ?? "unknown",
      code,
      healthy: code === 1,
    };
  }

  getConnection() {
    return mongoose.connection;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _buildMongooseOptions() {
    // autoIndex, bufferCommands, autoCreate are always forced off — not configurable.
    // autoIndex  → managed manually via _ensureIndexesAsync
    // bufferCommands → disabled; use waitUntilConnected() instead
    // autoCreate → disabled; run migrations/seeds before deploy
    const opts = {
      serverSelectionTimeoutMS: this.config.serverSelectionTimeoutMS,
      maxPoolSize:              this.config.maxPoolSize,
      minPoolSize:              this.config.minPoolSize,
      socketTimeoutMS:          this.config.socketTimeoutMS,
      connectTimeoutMS:         this.config.connectTimeoutMS,
      retryWrites:              this.config.retryWrites,
      retryReads:               this.config.retryReads,
      autoIndex:                false,
      bufferCommands:           false,
      autoCreate:               false,
    };

    if (this.config.ipv4Only) opts.family = 4;

    return opts;
  }

  _setupEventListeners() {
    if (this._listenersAttached) return;
    this._listenersAttached = true;

    mongoose.connection.on("error", (err) =>
      this.logger.error(`❌ MongoDB error: ${err.message}`)
    );
    mongoose.connection.on("disconnected", () =>
      this.logger.warn("⚠️  MongoDB disconnected")
    );
    mongoose.connection.on("reconnected", () =>
      this.logger.info("✅ MongoDB reconnected")
    );
  }

  _registerShutdownHandlers() {
    if (this._shutdownRegistered) return;
    this._shutdownRegistered = true;

    const handler = async (signal) => {
      this.logger.info(`⚠️  ${signal} received — closing MongoDB connection...`);
      try {
        await this.disconnect();
      } catch (_) {
        // Already logged in disconnect()
      }

      // FIX #1: Do NOT call process.exit() here. Instead, emit 'shutdown' and
      // let the application orchestrate the full shutdown sequence:
      //   server.close() → flush queues → then process.exit(0).
      //
      // In your server entry point:
      //   db.on('shutdown', ({ signal }) => server.close(() => process.exit(0)));
      //
      // Safety net: if the app doesn't exit within 10s, force it.
      // Unref'd so it doesn't itself block a clean exit.
      const forceExit = setTimeout(() => {
        this.logger.error("❌ Shutdown timeout — forcing exit");
        process.exit(1);
      }, 10_000);
      if (forceExit.unref) forceExit.unref();

      this.emit("shutdown", { signal });
    };

    process.once("SIGINT",  () => handler("SIGINT"));
    process.once("SIGTERM", () => handler("SIGTERM"));
  }

  _validateUri(uri) {
    if (!uri || typeof uri !== "string") {
      throw new Error("MONGODB_URI must be a non-empty string");
    }
    if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
      throw new Error(
        'Invalid MONGODB_URI — must start with "mongodb://" or "mongodb+srv://"'
      );
    }
  }

  /**
   * FIX #10: Strip credentials from error messages before they hit logs.
   * mongoose error messages can embed the full connection string.
   */
  _sanitizeErrorMessage(message, uri) {
    if (!message || !uri) return message;
    try {
      const parsed = new URL(uri);
      let sanitized = message;
      // Replace password
      if (parsed.password) {
        sanitized = sanitized.replaceAll(parsed.password, "***");
      }
      // Replace username
      if (parsed.username) {
        sanitized = sanitized.replaceAll(parsed.username, "***");
      }
      // Replace full URI
      sanitized = sanitized.replaceAll(uri, "[redacted-uri]");
      return sanitized;
    } catch {
      return message;
    }
  }

  /**
   * FIX #3: Unref the timer so it does not keep the process alive
   * during retry backoff if a shutdown signal arrives mid-sleep.
   */
  _sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (timer.unref) timer.unref();
    });
  }

  /**
   * Safe require for models not injected via constructor.
   * Returns null so callers skip gracefully instead of throwing.
   */
  _requireModel(path) {
    try {
      return require(path);
    } catch {
      this.logger.warn(`⚠️  Model not found at "${path}" — skipping related indexes`);
      return null;
    }
  }
}

module.exports = DatabaseService;