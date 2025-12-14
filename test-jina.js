const fetch = require('node-fetch');

async function test() {
  try {
    const resp = await fetch('https://r.jina.ai/https://x.com/BroTeamPills', { 
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000 
    });
    const html = await resp.text();
    const postsSection = html.split('Markdown Content:\n')[1] || html;
    const regex = /\[!\[Image[^\]]*\]\([^)]+\)\]\(https:\/\/x\.com\/BroTeamPills\/status\/(\d+)\/photo/g;
    let match;
    let count = 0;
    const ids = [];
    while ((match = regex.exec(postsSection)) !== null) {
      ids.push(match[1]);
      count++;
    }
    console.log('Total extracted:', count);
    console.log('IDs:', ids);
  } catch (err) {
    console.log('Error:', err.message);
  }
}

test();