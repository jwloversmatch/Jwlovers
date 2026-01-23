const logger = require("../../utils/logger");

const setupPresenceHandlers = (io, socket, redisService) => {
  const userId = socket.userId;
  const userName = socket.user?.name || socket.user?.username || `User-${userId?.substring(0, 8)}`;

  socket.on("presence:update-status", async (data) => {
    const { status, customStatus } = data;

    try {
      await redisService.refreshUserHeartbeat(userId);
      
      socket.broadcast.emit("user:status-update", {
        userId,
        name: userName,
        status: status || "online",
        customStatus: customStatus || "",
        lastSeen: new Date().toISOString(),
        avatar: socket.user?.avatar
      });
    } catch (error) {
      logger.error("Failed to update user status:", error);
    }
  });

  socket.on("presence:heartbeat", async () => {
    await redisService.refreshUserHeartbeat(userId);
  });

  socket.on("presence:get-online", async (callback) => {
    try {
      const onlineUsers = await redisService.getOnlineUsers();

      if (typeof callback === "function") {
        callback({ success: true, users: onlineUsers });
      } else {
        socket.emit("users:online", onlineUsers);
      }
    } catch (error) {
      logger.error("Failed to get online users:", error);
      callback?.({ success: false, error: "Failed to fetch online users" });
    }
  });
};

module.exports = { setupPresenceHandlers };