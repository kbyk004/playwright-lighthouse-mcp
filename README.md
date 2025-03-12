# Playwright-Lighthouse MCP Server

A MCP server that analyzes web site performance using Playwright and Lighthouse. Through the Model Context Protocol (MCP), LLMs can perform web site performance analysis.

## Features

- Performance analysis with Lighthouse
- Screenshot capture

## Setup

### Prerequisites

- Node.js 18 or higher
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/kbyk004/playwright-lighthouse-mcp.git
cd playwright-lighthouse-mcp

# Install dependencies
npm install
npx playwright install

# Build
npm run build
```

## Usage

### Debugging MCP Server

```bash
npm run inspector
```

### Integration with MCP Clients

This server is designed to be used with clients that support the Model Context Protocol (MCP). For example, it can be integrated with Claude for Desktop.

#### Configuration Example for Claude for Desktop

Add the following to the Claude for Desktop configuration file (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "playwright-lighthouse": {
      "command": "node",
      "args": [
        "/path-to/playwright-lighthouse-mcp/build/index.js"
      ]
    }
  }
}
```

## Available Tools

### 1. run-lighthouse

Runs a Lighthouse performance analysis on the currently open page.

Parameters:
- `url`: The URL of the website you want to analyze
- `categories`: Array of categories to analyze (default: ["performance"])
  - Available categories: "performance", "accessibility", "best-practices", "seo", "pwa"
- `maxItems`: Maximum number of improvement items to display for each category (default: 3, max: 5)

### 2. take-screenshot

Takes a screenshot of the currently open page.

Parameters:
- `url`: The URL of the website you want to capture
- `fullPage`: If true, captures a screenshot of the entire page (default: false)

## Output Format

The analysis results include:

- Overall scores for each selected category with color indicators
- Key improvement areas grouped by category
- Path to the saved report file

## License

MIT License - see [LICENSE](LICENSE) for details