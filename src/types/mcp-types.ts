/**
 * Common MCP protocol types used across the application
 */

/**
 * A parsed MCP protocol message with optional fields for different message types
 */
export interface ParsedMessage {
  id?: any;
  method?: string;
  result?: any;
  error?: any;
  params?: any;
  raw: string;
}