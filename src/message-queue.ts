export class MessageQueue<T = string> {
  private queue: T[] = [];

  add(message: T): void {
    this.queue.push(message);
  }

  flush(): T[] {
    const messages = [...this.queue];
    this.queue = [];
    return messages;
  }

  clear(): void {
    this.queue = [];
  }

  size(): number {
    return this.queue.length;
  }
}