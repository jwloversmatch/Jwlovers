// services/EmailQueueService.js - Async Email Queue
const emailService = require('@services/email');

class EmailQueueService {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.logger = console;
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
  }

  /**
   * Add email to queue and process asynchronously
   * Returns immediately without waiting for email to send
   */
  async queueEmail(emailType, emailData) {
    const job = {
      id: this.generateJobId(),
      type: emailType,
      data: emailData,
      retries: 0,
      createdAt: Date.now(),
      status: 'pending'
    };

    this.queue.push(job);
    
    // Log for monitoring
    this.logger.info(`📧 Email queued: ${emailType} for ${emailData.to || emailData.email}`);
    
    // Process queue asynchronously (don't await)
    this.processQueue().catch(err => {
      this.logger.error('Queue processing error:', err);
    });

    return {
      jobId: job.id,
      queued: true,
      message: 'Email queued for delivery'
    };
  }

  /**
   * Process queue in background
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      
      try {
        await this.processJob(job);
      } catch (error) {
        this.logger.error(`Failed to process email job ${job.id}:`, error);
        
        // Retry logic
        if (job.retries < this.maxRetries) {
          job.retries++;
          job.status = 'retrying';
          
          this.logger.info(`Retrying email job ${job.id} (attempt ${job.retries}/${this.maxRetries})`);
          
          // Re-queue with delay
          setTimeout(() => {
            this.queue.push(job);
            this.processQueue().catch(err => {
              this.logger.error('Retry queue processing error:', err);
            });
          }, this.retryDelay);
        } else {
          job.status = 'failed';
          this.logger.error(`Email job ${job.id} failed after ${this.maxRetries} retries`);
        }
      }
    }

    this.processing = false;
  }

  /**
   * Process individual email job
   */
  async processJob(job) {
    this.logger.info(`📤 Sending email: ${job.type} (job ${job.id})`);
    
    const startTime = Date.now();
    
    try {
      switch (job.type) {
        case 'dating_verification':
          await emailService.sendDatingUserVerification(
            job.data.email,
            job.data.token,
            job.data.firstName
          );
          break;
          
        case 'staff_verification':
          await emailService.sendStaffVerification(
            job.data.email,
            job.data.token,
            job.data.firstName,
            job.data.role,
            job.data.employeeId
          );
          break;
          
        case 'password_reset':
          await emailService.sendPasswordReset(
            job.data.email,
            job.data.token,
            job.data.firstName,
            job.data.wasLocked,
            job.data.role
          );
          break;
          
        case 'password_reset_confirmation':
          await emailService.sendPasswordResetConfirmation(
            job.data.email,
            job.data.firstName,
            job.data.wasLocked,
            job.data.role
          );
          break;
          
        case 'welcome':
          await emailService.sendDatingUserWelcome(
            job.data.email,
            job.data.firstName
          );
          break;
          
        default:
          throw new Error(`Unknown email type: ${job.type}`);
      }
      
      const duration = Date.now() - startTime;
      job.status = 'sent';
      
      this.logger.info(`✅ Email sent successfully: ${job.type} (${duration}ms)`);
      
    } catch (error) {
      this.logger.error(`❌ Email send failed: ${job.type}`, error);
      throw error;
    }
  }

  /**
   * Generate unique job ID
   */
  generateJobId() {
    return `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get queue status (for monitoring)
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      pending: this.queue.filter(j => j.status === 'pending').length,
      retrying: this.queue.filter(j => j.status === 'retrying').length
    };
  }
}

// Singleton instance
const emailQueueService = new EmailQueueService();

module.exports = emailQueueService;