import type { ParsedMessage } from '../types/mcp-types.js';

/**
 * Priority-based message queue for managing messages during server unavailability.
 * Ensures important messages (like initialization) are processed first when the
 * server becomes available again.
 */
export class PriorityMessageQueue {
  private messages: ParsedMessage[] = [];

  /**
   * Add a message to the queue with automatic priority assignment
   */
  add(message: ParsedMessage): void {
    this.messages.push(message);
  }

  /**
   * Get all queued messages sorted by priority
   * Clears the queue after returning messages
   */
  flush(): ParsedMessage[] {
    // Sort by priority (lower number = higher priority)
    const sorted = [...this.messages].sort((a, b) => {
      const priorityA = this.getPriority(a);
      const priorityB = this.getPriority(b);
      return priorityA - priorityB;
    });

    this.messages = [];
    return sorted;
  }

  /**
   * Get the current size of the queue
   */
  size(): number {
    return this.messages.length;
  }

  /**
   * Clear all messages from the queue
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Determine priority for a message
   * Lower number = higher priority
   */
  private getPriority(message: ParsedMessage): number {
    // Initialize has highest priority
    if (message.method === 'initialize') {
      return 0;
    }

    // Tool/resource calls are high priority (user is waiting)
    if (message.method?.startsWith('tools/') || message.method?.startsWith('resources/')) {
      return 1;
    }

    // Other requests are medium priority
    if (message.id !== undefined) {
      return 2;
    }

    // Notifications are lowest priority (fire-and-forget)
    return 3;
  }
}