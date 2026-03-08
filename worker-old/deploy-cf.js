const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 从 ~/global.json 读取配置
const globalConfig = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), 'global.json'), 'utf8'));
const ACCOUNT_ID = globalConfig.CLOUDFLARE_ACCOUNT_ID_CICYBOT;
const API_TOKEN = globalConfig.CLOUDFLARE_API_TOKEN_CICYBOT;

// KV 和 R2 配置 (首次运行需要创建)
let KV_NAMESPACE_ID = null;
const R2_BUCKET = 'clone-sites';

async function deploy(domain) {
  const slug = domain.replace(/\./g, '-');
  const outputDir = path.join('C:', 'Users', 'Administrator', 'clone-output', domain);
  
  console.log(`\n🚀 Deploying ${domain} to Cloudflare...\n`);
  
  // 1. 确保 KV 命名空间存在
  if (!KV_NAMESPACE_ID) {
    console.log('📦 Creating KV namespace...');
    try {
      const result = execSync(`wrangler kv:namespace create "CLONE_API_MOCK"`, { encoding: 'utf8' });
      const match = result.match(/id = "([^"]+)"/);
      if (match) {
        KV_NAMESPACE_ID = match[1];
        console.log(`✅ KV namespace created: ${KV_NAMESPACE_ID}`);
        
        // 更新 wrangler.toml
        const tomlPath = path.join(__dirname, 'wrangler.toml');
        let toml = fs.readFileSync(tomlPath, 'utf8');
        toml = toml.replace('YOUR_KV_NAMESPACE_ID', KV_NAMESPACE_ID);
        fs.writeFileSync(tomlPath, toml);
      }
    } catch (e) {
      console.log('⚠️  KV namespace may already exist');
    }
  }
  
  // 2. 确保 R2 bucket 存在
  console.log('📦 Checking R2 bucket...');
  try {
    execSync(`wrangler r2 bucket create ${R2_BUCKET}`, { stdio: 'ignore' });
    console.log(`✅ R2 bucket created: ${R2_BUCKET}`);
  } catch (e) {
    console.log(`✅ R2 bucket exists: ${R2_BUCKET}`);
  }
  
  // 3. 上传静态资源到 R2
  console.log('\n📤 Uploading static files to R2...');
  const staticDir = path.join(outputDir, 'static');
  let fileCount = 0;
  
  function uploadDir(dir, prefix = '') {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        uploadDir(fullPath, prefix + file + '/');
      } else {
        const r2Key = `${slug}/${prefix}${file}`;
        try {
          execSync(`wrangler r2 object put ${R2_BUCKET}/${r2Key} --file="${fullPath}" --remote`, { stdio: 'ignore' });
          fileCount++;
          process.stdout.write(`\r   Uploaded ${fileCount} files...`);
        } catch (e) {
          console.error(`\n❌ Failed to upload ${r2Key}`);
        }
      }
    }
  }
  
  uploadDir(staticDir);
  console.log(`\n✅ Uploaded ${fileCount} files to R2\n`);
  
  // 4. 上传 API mock 到 KV
  console.log('📤 Uploading API mocks to KV...');
  const apiDir = path.join(outputDir, 'api-decrypted');
  let apiCount = 0;
  
  function uploadApiDir(dir, prefix = '') {
    if (!fs.existsSync(dir)) return;
    
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        uploadApiDir(fullPath, prefix + file + '/');
      } else if (file.endsWith('.json')) {
        const apiPath = prefix + file.replace('.json', '');
        const key = `${slug}:/hall/api/${apiPath}`;
        const value = fs.readFileSync(fullPath, 'utf8');
        
        try {
          // 使用临时文件避免命令行转义问题
          const tmpFile = path.join(require('os').tmpdir(), `kv-${Date.now()}.json`);
          fs.writeFileSync(tmpFile, value);
          execSync(`wrangler kv:key put --namespace-id=${KV_NAMESPACE_ID} "${key}" --path="${tmpFile}"`, { stdio: 'ignore' });
          fs.unlinkSync(tmpFile);
          
          apiCount++;
          process.stdout.write(`\r   Uploaded ${apiCount} API mocks...`);
        } catch (e) {
          console.error(`\n❌ Failed to upload ${key}`);
        }
      }
    }
  }
  
  uploadApiDir(apiDir);
  console.log(`\n✅ Uploaded ${apiCount} API mocks to KV\n`);
  
  // 5. 部署 Worker (如果还没部署)
  console.log('🚀 Deploying worker...');
  try {
    execSync('wrangler deploy', { cwd: __dirname, stdio: 'inherit' });
    console.log('✅ Worker deployed\n');
  } catch (e) {
    console.error('❌ Worker deployment failed');
    process.exit(1);
  }
  
  // 6. 输出访问 URL
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n🌐 Clone site deployed!\n`);
  console.log(`   URL: https://${slug}.electron-clone-worker.workers.dev`);
  console.log(`\n   Files: ${fileCount} static + ${apiCount} API mocks`);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// CLI
if (require.main === module) {
  const domain = process.argv[2];
  if (!domain) {
    console.error('Usage: node deploy-cf.js <domain>');
    process.exit(1);
  }
  deploy(domain).catch(console.error);
}

module.exports = { deploy };
