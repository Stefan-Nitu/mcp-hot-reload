#!/usr/bin/env node

// Comprehensive MCP test server with all content types
process.stderr.write('[test-server] All content types server started\n');

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const message = JSON.parse(line);
      process.stderr.write(`[test-server] Received: ${message.method || 'response'}\n`);

      if (message.method === 'initialize') {
        const response = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'all-content-types-server', version: '1.0.0' },
            capabilities: { tools: {}, resources: {} }
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
      else if (message.method === 'tools/list') {
        const response = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [
              { name: 'getText', description: 'Returns plain text content' },
              { name: 'getImage', description: 'Returns base64 image content' },
              { name: 'getResourceLinks', description: 'Returns resource links without content' },
              { name: 'getEmbeddedResource', description: 'Returns embedded resource with full content' },
              { name: 'getStructuredData', description: 'Returns JSON structured content' },
              { name: 'getMixedContent', description: 'Returns multiple content types in one response' },
              { name: 'echo', description: 'Echoes back the input' }
            ]
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
      else if (message.method === 'tools/call') {
        const { name, arguments: args } = message.params || {};

        let response;
        switch (name) {
          case 'getText':
            response = {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [{
                  type: 'text',
                  text: args?.message || 'This is plain text content'
                }]
              }
            };
            break;

          case 'getImage':
            // 1x1 red pixel PNG
            response = {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [{
                  type: 'image',
                  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
                  mimeType: 'image/png'
                }]
              }
            };
            break;

          case 'getResourceLinks':
            response = {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `Found ${args?.count || 3} files:`
                  },
                  {
                    type: 'resource_link',
                    uri: 'file:///project/README.md',
                    name: 'README.md',
                    description: 'Project documentation',
                    mimeType: 'text/markdown'
                  },
                  {
                    type: 'resource_link',
                    uri: 'file:///project/src/index.ts',
                    name: 'index.ts',
                    description: 'Main entry point',
                    mimeType: 'text/typescript'
                  },
                  {
                    type: 'resource_link',
                    uri: 'file:///project/package.json',
                    name: 'package.json',
                    description: 'Node.js package manifest',
                    mimeType: 'application/json'
                  }
                ]
              }
            };
            break;

          case 'getEmbeddedResource':
            response = {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [{
                  type: 'resource',
                  resource: {
                    uri: 'file:///project/config.json',
                    title: 'Configuration File',
                    mimeType: 'application/json',
                    text: JSON.stringify({
                      debug: true,
                      port: 3000,
                      api: {
                        endpoint: 'https://api.example.com',
                        timeout: 5000
                      }
                    }, null, 2)
                  }
                }]
              }
            };
            break;

          case 'getStructuredData':
            const weatherData = {
              temperature: 22.5,
              humidity: 65,
              conditions: 'Partly cloudy',
              wind: { speed: 10, direction: 'NW' },
              forecast: [
                { day: 'Monday', high: 25, low: 18 },
                { day: 'Tuesday', high: 27, low: 20 }
              ]
            };
            response = {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify(weatherData, null, 2)
                }],
                structuredContent: weatherData
              }
            };
            break;

          case 'getMixedContent':
            response = {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: 'Analysis complete. Found the following:'
                  },
                  {
                    type: 'resource_link',
                    uri: 'file:///analysis/report.pdf',
                    name: 'report.pdf',
                    description: 'Full analysis report',
                    mimeType: 'application/pdf'
                  },
                  {
                    type: 'image',
                    data: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVQIHWP8z8AAQgwMDAwMAA0FAAHghgv9AAAAAElFTkSuQmCC',
                    mimeType: 'image/png'
                  },
                  {
                    type: 'text',
                    text: 'Summary: 3 issues found, 2 warnings'
                  }
                ],
                structuredContent: {
                  issues: 3,
                  warnings: 2,
                  status: 'completed'
                }
              }
            };
            break;

          case 'echo':
            response = {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [{
                  type: 'text',
                  text: `Echo: ${JSON.stringify(args)}`
                }]
              }
            };
            break;

          default:
            response = {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32601,
                message: `Unknown tool: ${name}`
              }
            };
        }

        process.stdout.write(JSON.stringify(response) + '\n');
        process.stderr.write(`[test-server] Sent response for ${name}\n`);
      }
    } catch (e) {
      process.stderr.write(`[test-server] Parse error: ${e.message}\n`);
    }
  }
});

process.stdin.on('end', () => {
  process.stderr.write('[test-server] Input ended\n');
  process.exit(0);
});