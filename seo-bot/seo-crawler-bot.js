const puppeteer = require('puppeteer');
const lighthouse = require('lighthouse').default || require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const ExcelJS = require('exceljs');
const fs = require('fs');
const cron = require('node-cron');
const axios = require('axios');
const xml2js = require('xml2js');
const { URL } = require('url');

const START_URL = "https://mentoreducation.co.uk";  
const SITEMAP_URL = new URL("/page-sitemap.xml", START_URL).href;  
const REPORTS_FOLDER = "seo_reports";  
console.log(typeof lighthouse);
// Ensure the reports folder exists
if (!fs.existsSync(REPORTS_FOLDER)) {
    fs.mkdirSync(REPORTS_FOLDER);
}

// Function to add a random delay between requests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch and parse sitemap
async function getSitemapUrls(sitemapUrl) {
    try {
        const response = await axios.get(sitemapUrl);
        const result = await xml2js.parseStringPromise(response.data);
        let urls = [];

        if (result.urlset && result.urlset.url) {
            urls = result.urlset.url.map(entry => entry.loc[0]);  
        }

        console.log(`✅ Found ${urls.length} URLs in the sitemap.`);
        return urls;
    } catch (error) {
        console.error(`❌ Failed to fetch sitemap: ${error.message}`);
        return [];
    }
}

// Function to get performance score using Lighthouse
async function getPerformanceScore(url) {
    try {
        const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
        const options = { 
            logLevel: 'info', 
            output: 'json', 
            onlyCategories: ['performance'], 
            port: chrome.port,
            formFactor: 'mobile', // ✅ Set Lighthouse to use Mobile emulation
            screenEmulation: {
                mobile: true,
                width: 375, // iPhone X width
                height: 812, // iPhone X height
                deviceScaleFactor: 2,
                disabled: false
            }
        };
        const runnerResult = await lighthouse(url, options);
        await chrome.kill(); // Close Chrome after audit
        console.log(runnerResult.lhr.configSettings.formFactor);

        return runnerResult.lhr.categories.performance.score * 100; // Convert to %
    } catch (error) {
        console.error(`⚠️ Error auditing ${url}:`, error.message);
        return "Error";
    }
}

// Main function
async function runSeoAudit() {
    console.log(`[${new Date().toISOString()}] 🚀 Starting SEO Audit...`);

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--remote-debugging-port=9222',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    const links = await getSitemapUrls(SITEMAP_URL);
    
    if (links.length === 0) {
        console.log("❌ No URLs found in the sitemap. Exiting...");
        await browser.close();
        return;
    }

    let results = [];
    for (const link of links) {
        console.log(`📊 Checking: ${link}`);

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        try {
            await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const score = await getPerformanceScore(link);
            results.push({ url: link, performance: score });
        } catch (error) {
            console.error(`❌ Failed to process ${link}: ${error.message}`);
        } finally {
            await page.close();
        }

        // Add delay between requests (2-5 seconds)
        await delay(Math.floor(Math.random() * 3000) + 2000);
    }

    await browser.close();

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const excelFile = `${REPORTS_FOLDER}/seo-report-${timestamp}.xlsx`;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('SEO Report');
    worksheet.columns = [
        { header: 'URL', key: 'url', width: 50 },
        { header: 'Performance Score', key: 'performance', width: 20 }
    ];
    results.forEach(data => worksheet.addRow(data));
    await workbook.xlsx.writeFile(excelFile);
    console.log(`✅ SEO Audit completed. Report saved: ${excelFile}`);
}

// Schedule and run audit
cron.schedule('0 */2 * * *', runSeoAudit);
runSeoAudit();
console.log("✅ SEO Audit bot is running. It will scan every 2 hours."); 
