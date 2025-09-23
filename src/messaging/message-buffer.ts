/**
 * Handles buffering and parsing of partial messages from streams.
 * Messages in the MCP protocol are newline-delimited JSON, but network
 * streams may split messages across multiple chunks.
 */
export class MessageBuffer {
  private partialMessage = '';

  /**
   * Append data to the buffer and extract complete messages.
   *
   * @param data - Raw data from the stream
   * @returns Array of complete message strings
   */
  append(data: string): string[] {
    const lines = (this.partialMessage + data).split('\n');
    const completeMessages: string[] = [];

    // Process all complete lines
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line) {
        completeMessages.push(line + '\n');
      }
    }

    // Keep the last incomplete line (if any)
    this.partialMessage = lines[lines.length - 1];

    return completeMessages;
  }

  /**
   * Clear the buffer, discarding any partial message.
   */
  clear(): void {
    this.partialMessage = '';
  }

  /**
   * Check if there's a partial message waiting.
   */
  hasPartial(): boolean {
    return this.partialMessage.length > 0;
  }

  /**
   * Get the current partial message (for debugging).
   */
  getPartial(): string {
    return this.partialMessage;
  }
}