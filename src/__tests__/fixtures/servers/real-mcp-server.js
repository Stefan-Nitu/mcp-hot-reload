#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  {
    name: 'test-mcp-server',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {},
      resources: {}
    }
  }
);

// Tool: getText - returns plain text
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'getText',
        description: 'Returns plain text content',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' }
          }
        }
      },
      {
        name: 'getImage',
        description: 'Returns base64 image content'
      },
      {
        name: 'getStructuredData',
        description: 'Returns JSON structured content'
      },
      {
        name: 'getMixedContent',
        description: 'Returns multiple content types'
      },
      {
        name: 'echo',
        description: 'Echo a message',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' }
          },
          required: ['message']
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'getText':
      return {
        content: [
          {
            type: 'text',
            text: args?.message || 'This is plain text content from real MCP server'
          }
        ]
      };

    case 'getImage':
      // 1x1 red pixel PNG
      return {
        content: [
          {
            type: 'image',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
            mimeType: 'image/png'
          }
        ]
      };

    case 'getStructuredData':
      const weatherData = {
        temperature: 22.5,
        humidity: 65,
        conditions: 'Partly cloudy',
        wind: { speed: 10, direction: 'NW' }
      };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(weatherData, null, 2)
          }
        ]
      };

    case 'getMixedContent':
      return {
        content: [
          {
            type: 'text',
            text: 'Analysis complete. Found the following:'
          },
          {
            type: 'image',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVQIHWP8z8AAQgwMDAwMAA0FAAHghgv9AAAAAElFTkSuQmCC',
            mimeType: 'image/png'
          },
          {
            type: 'text',
            text: 'Summary: Tests passed'
          }
        ]
      };

    case 'echo':
      return {
        content: [
          {
            type: 'text',
            text: `Echo: ${args?.message || 'no message'}`
          }
        ]
      };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[test-server] Real MCP Server Started');
}

main().catch(error => {
  console.error('Server error:', error);
  process.exit(1);
});