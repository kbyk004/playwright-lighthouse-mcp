import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { chromium, Browser, Page } from "playwright";
import { playAudit } from "playwright-lighthouse";
import { writeFileSync, existsSync, readFileSync, readdirSync, mkdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get the current directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create directory for saving reports
const reportsDir = path.join(__dirname, "../reports");
if (!existsSync(reportsDir)) {
  mkdirSync(reportsDir, { recursive: true });
}

// Create MCP server
const server = new McpServer({
  name: "playwright-lighthouse",
  version: "1.0.0",
});

// Variable to hold browser instance
let browser: Browser | null = null;
let page: Page | null = null;

// Function to launch browser
async function launchBrowser() {
  if (!browser) {
    // Launch browser with remote debugging port
    browser = await chromium.launch({
      headless: true,
      args: [
        '--remote-debugging-port=9222',
        '--ignore-certificate-errors'
      ],
      timeout: 30000,
    });
  }
  return browser;
}

// Function to open a page
async function getPage() {
  if (!page) {
    const browser = await launchBrowser();
    page = await browser.newPage();
  }
  return page;
}

// Function to navigate to URL
async function navigateToUrl(url: string) {
  try {
    const page = await getPage();
    await page.goto(url, { waitUntil: "load" });
    return page;
  } catch (error) {
    throw error;
  }
}

// Function to close browser
async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

// Tool 1: Run Lighthouse performance analysis
server.tool(
  "run-lighthouse",
  "Runs a Lighthouse performance analysis on the currently open page",
  {
    url: z.string().url().describe("URL of the website you want to analyze"),
    categories: z.array(z.enum(["performance", "accessibility", "best-practices", "seo", "pwa"]))
      .default(["performance"])
      .describe("Categories to analyze (performance, accessibility, best-practices, seo, pwa)"),
    maxItems: z.number().min(1).max(5).default(3)
      .describe("Maximum number of improvement items to display for each category"),
  },
  async (params, extra): Promise<{
    content: { type: "text"; text: string }[];
    isError?: boolean;
  }> => {
    try {
      // Automatically launch browser and navigate to URL
      await navigateToUrl(params.url);

      const url = page!.url();

      try {
        // CDP connection method for the latest Playwright version
        const browserContext = browser!.contexts()[0];
        const cdpSession = await browserContext.newCDPSession(page!);
        
        // Get browser version information to check debug port
        const versionInfo = await cdpSession.send('Browser.getVersion');
        
        // Get port number from WebSocket debugger URL
        // Note: Using the port specified at launch (9222)
        const port = 9222;

        // Function to run Lighthouse audit
        const runAudit = async () => {
          try {
            // Create report path
            const hostname = new URL(url).hostname.replace(/\./g, '-');
            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            const reportPath = path.join(__dirname, `../reports/lighthouse-${hostname}-${timestamp}.json`);
            
            try {
              // Run Lighthouse audit
              const results = await playAudit({
                page: page!,
                port: port,
                thresholds: {
                  performance: 0,
                  accessibility: 0,
                  'best-practices': 0,
                  seo: 0,
                  pwa: 0
                },
                reports: {
                  formats: {
                    html: false,
                    json: true
                  },
                  directory: path.join(__dirname, "../reports"),
                  name: `lighthouse-${hostname}-${timestamp}`
                },
                ignoreError: true,
                config: {
                  extends: 'lighthouse:default'
                }
              });
              
              // Function to represent score evaluation with color
              const getScoreEmoji = (score: number): string => {
                if (score >= 90) return "🟢"; // Good
                if (score >= 50) return "🟠"; // Average
                return "🔴"; // Poor
              };

              // Process results directly
              let scoreText = "📊 Lighthouse Scores:\n";
              let improvementText = "\n\n🔍 Key Improvement Areas:";
              
              // Prepare arrays to store improvement items
              const improvementItems: { category: string; title: string; description: string }[] = [];
              
              // Check if results are available directly
              if (results && results.lhr && results.lhr.categories) {
                // Get selected categories from the direct results
                const availableCategories = Object.keys(results.lhr.categories);
                
                // Filter categories based on user selection
                const selectedCategories = params.categories.filter(cat => 
                  availableCategories.includes(cat)
                );
                
                // Process each category
                for (const category of selectedCategories) {
                  const categoryData = results.lhr.categories[category];
                  
                  if (categoryData) {
                    // Get all audits for this category
                    const audits = results.lhr.audits;
                    const categoryAudits = Object.keys(audits).filter(
                      auditId => {
                        const audit = audits[auditId];
                        return audit.details && 
                               categoryData.auditRefs.some((ref: any) => ref.id === auditId);
                      }
                    );
                    
                    // Get score
                    let scoreDisplay = '';
                    
                    if (categoryData.score === null) {
                      // When score cannot be calculated
                      scoreDisplay = `⚪️ ${category.charAt(0).toUpperCase() + category.slice(1)}: Not measurable`;
                    } else {
                      // When score can be calculated
                      const score = Math.round(categoryData.score * 100);
                      scoreDisplay = `${getScoreEmoji(score)} ${category.charAt(0).toUpperCase() + category.slice(1)}: ${score}/100`;
                    }
                    
                    // Add score to response
                    scoreText += scoreDisplay + '\n';
                    
                    // Collect improvement items
                    for (const auditId of categoryAudits) {
                      const audit = audits[auditId];
                      if ((audit.score || 0) < 0.9) {
                        improvementItems.push({
                          category,
                          title: audit.title,
                          description: audit.description,
                        });
                      }
                    }
                  }
                }
              } else {
                // Fallback to reading from file if direct results are not available
                try {
                  // Load JSON file
                  if (existsSync(reportPath)) {
                    // Read and parse JSON file
                    const jsonData = JSON.parse(readFileSync(reportPath, 'utf8'));
                    
                    if (jsonData && jsonData.categories) {
                      // Get selected categories from the report
                      const availableCategories = Object.keys(jsonData.categories);
                      
                      // Filter categories based on user selection
                      const selectedCategories = params.categories.filter(cat => 
                        availableCategories.includes(cat)
                      );
                      
                      // Process each category
                      for (const category of selectedCategories) {
                        const categoryData = jsonData.categories[category];
                        
                        if (categoryData) {
                          // Get all audits for this category
                          const audits = jsonData.audits;
                          const categoryAudits = Object.keys(audits).filter(
                            auditId => {
                              const audit = audits[auditId];
                              return audit.details && 
                                     categoryData.auditRefs.some((ref: any) => ref.id === auditId);
                            }
                          );
                          
                          // Get score
                          let scoreDisplay = '';
                          
                          if (categoryData.score === null) {
                            // When score cannot be calculated
                            scoreDisplay = `⚪️ ${category.charAt(0).toUpperCase() + category.slice(1)}: Not measurable`;
                          } else {
                            // When score can be calculated
                            const score = Math.round(categoryData.score * 100);
                            scoreDisplay = `${getScoreEmoji(score)} ${category.charAt(0).toUpperCase() + category.slice(1)}: ${score}/100`;
                          }
                          
                          // Add score to response
                          scoreText += scoreDisplay + '\n';
                          
                          // Collect improvement items
                          for (const auditId of categoryAudits) {
                            const audit = audits[auditId];
                            if ((audit.score || 0) < 0.9) {
                              improvementItems.push({
                                category,
                                title: audit.title,
                                description: audit.description,
                              });
                            }
                          }
                        }
                      }
                    }
                  } else {
                    // List all files in directory
                    const files = readdirSync(path.join(__dirname, "../reports"));
                    
                    // Find the latest JSON file
                    const jsonFiles = files.filter(file => file.endsWith('.json'));
                    if (jsonFiles.length > 0) {
                      const latestFile = jsonFiles.sort().pop();
                      
                      // Use the latest file
                      const latestPath = path.join(__dirname, "../reports", latestFile || '');
                      try {
                        const latestData = JSON.parse(readFileSync(latestPath, 'utf8'));
                        
                        if (latestData && latestData.categories) {
                          // Process each category
                          for (const category of params.categories) {
                            const categoryData = latestData.categories[category];
                            
                            if (categoryData) {
                              // Get all audits for this category
                              const audits = latestData.audits;
                              const categoryAudits = Object.keys(audits).filter(
                                auditId => {
                                  const audit = audits[auditId];
                                  return audit.details && 
                                         categoryData.auditRefs.some((ref: any) => ref.id === auditId);
                                }
                              );
                              
                              // Get score
                              let scoreDisplay = '';
                              
                              if (categoryData.score === null) {
                                // When score cannot be calculated
                                scoreDisplay = `⚪️ ${category.charAt(0).toUpperCase() + category.slice(1)}: Not measurable`;
                              } else {
                                // When score can be calculated
                                const score = Math.round(categoryData.score * 100);
                                scoreDisplay = `${getScoreEmoji(score)} ${category.charAt(0).toUpperCase() + category.slice(1)}: ${score}/100`;
                              }
                              
                              // Add score to response
                              scoreText += scoreDisplay + '\n';
                              
                              // Collect improvement items
                              for (const auditId of categoryAudits) {
                                const audit = audits[auditId];
                                if ((audit.score || 0) < 0.9) {
                                  improvementItems.push({
                                    category,
                                    title: audit.title,
                                    description: audit.description,
                                  });
                                }
                              }
                            }
                          }
                        }
                      } catch (err: any) {
                        throw new Error(`Failed to read latest JSON file: ${err.message}`);
                      }
                    } else {
                      throw new Error('Lighthouse report file not found.');
                    }
                  }
                } catch (error) {
                  throw error; // Propagate to higher error handler
                }
              }

              // Display improvement points (sorted by weight)
              if (improvementItems.length > 0) {
                // Sort by category
                improvementItems.sort((a, b) => {
                  if (a.category !== b.category) {
                    return a.category.localeCompare(b.category);
                  }
                  return a.title.localeCompare(b.title);
                });
                
                // Group and display
                let currentCategory = '';
                for (const imp of improvementItems.slice(0, params.maxItems * params.categories.length)) {
                  if (currentCategory !== imp.category) {
                    currentCategory = imp.category;
                    // Display category name appropriately
                    const categoryDisplayName = {
                      'performance': 'Performance',
                      'accessibility': 'Accessibility',
                      'best-practices': 'Best Practices',
                      'seo': 'SEO',
                      'pwa': 'PWA'
                    }[imp.category] || imp.category;
                    
                    improvementText += `\n\n【${categoryDisplayName}】Improvement items:`;
                  }
                  improvementText += `\n・${imp.title}`;
                }
              } else {
                improvementText += "\n\nNo improvement items found.";
              }

              // Close browser automatically after analysis is complete
              await closeBrowser();

              // Return the results
              return {
                content: [
                  {
                    type: "text" as const,
                    text: scoreText + improvementText,
                  },
                  {
                    type: "text" as const,
                    text: `report save path: ${reportPath}`,
                  },
                ],
              };
            } catch (error: any) {
              // Close browser even when an error occurs
              await closeBrowser();
              
              throw error; // Propagate to higher error handler
            }
          } catch (error: any) {
            // Close browser even when an error occurs
            await closeBrowser();
            
            return {
              content: [
                {
                  type: "text" as const,
                  text: `An error occurred during Lighthouse analysis: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        };

        return await runAudit();
      } catch (error: any) {
        // Close browser even when an error occurs
        await closeBrowser();
        
        return {
          content: [
            {
              type: "text" as const,
              text: `An error occurred during Lighthouse analysis: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error: any) {
      // Close browser even when an error occurs
      await closeBrowser();

      return {
        content: [
          {
            type: "text" as const,
            text: `An error occurred during Lighthouse analysis: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 2: Take screenshot
server.tool(
  "take-screenshot",
  "Takes a screenshot of the currently open page",
  {
    url: z.string().url().describe("URL of the website you want to capture"),
    fullPage: z.boolean().default(false).describe("If true, captures a screenshot of the entire page"),
  },
  async ({ url, fullPage }) => {
    try {
      // Automatically launch browser and navigate to URL
      await navigateToUrl(url);

      const screenshot = await page!.screenshot({ fullPage, type: "jpeg", quality: 80 });
      
      // Create directory for screenshots if it doesn't exist
      const screenshotsDir = path.join(__dirname, "../screenshots");
      if (!existsSync(screenshotsDir)) {
        mkdirSync(screenshotsDir, { recursive: true });
      }
      
      // Save screenshot
      const screenshotPath = path.join(screenshotsDir, `screenshot-${Date.now()}.jpg`);
      writeFileSync(screenshotPath, screenshot);

      // Close browser after taking screenshot
      await closeBrowser();
      
      return {
        content: [
          {
            type: "text" as const,
            text: `Screenshot captured. ${fullPage ? "(Full page)" : ""}`,
          },
          {
            type: "text" as const,
            text: `Saved to: ${screenshotPath}`,
          },
          {
            type: "image" as const,
            data: screenshot.toString("base64"),
            mimeType: "image/jpeg",
          },
        ],
      };
    } catch (error) {
      // Close browser even when an error occurs
      await closeBrowser();
      
      return {
        content: [
          {
            type: "text" as const,
            text: `An error occurred while taking screenshot: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start server
async function main() {
  try {
    // Create necessary directories
    const screenshotsDir = path.join(__dirname, "../screenshots");
    if (!existsSync(screenshotsDir)) {
      mkdirSync(screenshotsDir, { recursive: true });
    }

    // Start server
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    process.exit(1);
  }
}

// Cleanup function
async function cleanup() {
  if (browser) {
    await browser.close();
  }
  process.exit(0);
}

// Cleanup on shutdown
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Start server
main().catch(() => {
  process.exit(1);
});
