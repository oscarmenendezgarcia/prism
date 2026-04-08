import http from 'node:http';
import fs from 'fs';
import path from 'path';

// Test 1: Create a space with projectClaudeMdPath
const data1 = JSON.stringify({ 
  name: 'Test Project',
  projectClaudeMdPath: 'docs/CLAUDE.md' 
});
const options1 = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/spaces',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data1) }
};
const req1 = http.request(options1, (res) => {
  let body1 = '';
  res.on('data', (chunk) => body1 += chunk);
  res.on('end', () => {
    const space = JSON.parse(body1);
    console.log('Space created:', JSON.stringify(space, null, 2));
    
    // Verify the space has projectClaudeMdPath
    if (space.projectClaudeMdPath === 'docs/CLAUDE.md') {
      console.log('✓ projectClaudeMdPath is set correctly');
    } else {
      console.log('✗ projectClaudeMdPath is NOT set correctly');
    }
    
    // Create the CLAUDE.md file in the space's data directory
    const spaceDataDir = path.join('/Users/oscarmenendezgarcia/Documents/IdeaProjects/platform/new/prism/data/spaces', space.id);
    const docsDir = path.join(spaceDataDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const claudePath = path.join(docsDir, 'CLAUDE.md');
    fs.writeFileSync(claudePath, '# Test Project\n\nProject rules here.', 'utf8');
    console.log('✓ Created CLAUDE.md at:', claudePath);
    
    // Test 2: Get project CLAUDE.md
    const options2 = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/project/claude-md?spaceId=' + space.id,
      method: 'GET',
    };
    const req2 = http.request(options2, (res2) => {
      let body2 = '';
      res2.on('data', (chunk) => body2 += chunk);
      res2.on('end', () => {
        const result = JSON.parse(body2);
        console.log('\nProject CLAUDE.md response:', JSON.stringify(result, null, 2));
      });
    });
    req2.end();
  });
});
req1.write(data1);
req1.end();
