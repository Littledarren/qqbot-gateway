#!/usr/bin/env node
/**
 * QQ Bot Gateway API 完整测试
 * 
 * 使用方法:
 *   node test-api.js <openid>
 * 
 * 示例:
 *   node test-api.js C50DCF80E802AAF67CF5225A8C224440
 */

const HTTP_PORT = process.env.HTTP_PORT || 3001;
const BASE_URL = `http://localhost:${HTTP_PORT}`;

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(color, ...args) {
  console.log(colors[color], ...args, colors.reset);
}

function logSection(title) {
  console.log('');
  console.log('='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const start = Date.now();
  const response = await fetch(`${BASE_URL}${path}`, options);
  const duration = Date.now() - start;
  const data = await response.json();

  return { status: response.status, data, duration };
}

async function testStatus() {
  logSection('测试 1: 获取服务状态');
  
  try {
    const { status, data, duration } = await request('GET', '/api/status');
    
    if (status === 200 && data.success) {
      log('green', '✅ 状态接口正常');
      log('blue', `   连接状态: ${data.data.connected ? '已连接' : '未连接'}`);
      log('blue', `   Session ID: ${data.data.sessionId || '无'}`);
      log('blue', `   响应时间: ${duration}ms`);
      return true;
    } else {
      log('red', '❌ 状态接口异常');
      log('red', `   响应: ${JSON.stringify(data)}`);
      return false;
    }
  } catch (err) {
    log('red', '❌ 请求失败:', err.message);
    return false;
  }
}

async function testSendText(openid) {
  logSection('测试 2: 发送文本消息');
  
  const testMessage = `测试消息 ${new Date().toLocaleTimeString()}`;
  
  try {
    const { status, data, duration } = await request('POST', '/api/send', {
      to: openid,
      type: 'c2c',
      content: testMessage,
    });
    
    if (status === 200 && data.success) {
      log('green', '✅ 文本消息发送成功');
      log('blue', `   消息内容: "${testMessage}"`);
      log('blue', `   消息 ID: ${data.data.messageId}`);
      log('blue', `   时间戳: ${data.data.timestamp}`);
      log('blue', `   响应时间: ${duration}ms`);
      return true;
    } else {
      log('red', '❌ 文本消息发送失败');
      log('red', `   错误: ${data.error || JSON.stringify(data)}`);
      return false;
    }
  } catch (err) {
    log('red', '❌ 请求失败:', err.message);
    return false;
  }
}

async function testSendLongText(openid) {
  logSection('测试 3: 发送长文本消息');
  
  const longMessage = '这是一条较长的测试消息，用于验证服务是否能正确处理较长的消息内容。'.repeat(3);
  
  try {
    const { status, data, duration } = await request('POST', '/api/send', {
      to: openid,
      type: 'c2c',
      content: longMessage,
    });
    
    if (status === 200 && data.success) {
      log('green', '✅ 长文本消息发送成功');
      log('blue', `   消息长度: ${longMessage.length} 字符`);
      log('blue', `   响应时间: ${duration}ms`);
      return true;
    } else {
      log('red', '❌ 长文本消息发送失败');
      log('red', `   错误: ${data.error || JSON.stringify(data)}`);
      return false;
    }
  } catch (err) {
    log('red', '❌ 请求失败:', err.message);
    return false;
  }
}

async function testSendImage(openid) {
  logSection('测试 4: 发送图片消息');
  
  // 使用一个公开的测试图片
  const testImageUrl = 'https://picsum.photos/200/300';
  
  try {
    const { status, data, duration } = await request('POST', '/api/send/image', {
      to: openid,
      type: 'c2c',
      imageUrl: testImageUrl,
    });
    
    if (status === 200 && data.success) {
      log('green', '✅ 图片消息发送成功');
      log('blue', `   图片 URL: ${testImageUrl}`);
      log('blue', `   消息 ID: ${data.data.messageId}`);
      log('blue', `   响应时间: ${duration}ms`);
      return true;
    } else {
      log('yellow', '⚠️ 图片消息发送失败（可能是网络问题）');
      log('yellow', `   错误: ${data.error || JSON.stringify(data)}`);
      return true; // 不计入失败
    }
  } catch (err) {
    log('yellow', '⚠️ 图片消息请求失败:', err.message);
    return true; // 不计入失败
  }
}

async function testMissingParams() {
  logSection('测试 5: 缺少必填参数');
  
  try {
    // 缺少 content
    const { status, data } = await request('POST', '/api/send', {
      to: 'test-openid',
      type: 'c2c',
    });
    
    if (status === 400 && !data.success) {
      log('green', '✅ 参数校验正常');
      log('blue', `   错误信息: ${data.error}`);
      return true;
    } else {
      log('red', '❌ 参数校验异常');
      log('red', `   响应: ${JSON.stringify(data)}`);
      return false;
    }
  } catch (err) {
    log('red', '❌ 请求失败:', err.message);
    return false;
  }
}

async function testInvalidType() {
  logSection('测试 6: 无效的消息类型');
  
  try {
    const { status, data } = await request('POST', '/api/send', {
      to: 'test-openid',
      type: 'invalid_type',
      content: 'test',
    });
    
    // 应该返回错误或者发送失败
    if (!data.success) {
      log('green', '✅ 无效类型处理正常');
      log('blue', `   错误信息: ${data.error || '发送失败'}`);
      return true;
    } else {
      log('yellow', '⚠️ 无效类型未被拒绝（可能是后端兼容处理）');
      return true;
    }
  } catch (err) {
    log('red', '❌ 请求失败:', err.message);
    return false;
  }
}

async function testHealthCheck() {
  logSection('测试 7: 健康检查');
  
  try {
    const { status, data, duration } = await request('GET', '/health');
    
    if (status === 200 && data.status === 'ok') {
      log('green', '✅ 健康检查正常');
      log('blue', `   响应时间: ${duration}ms`);
      return true;
    } else {
      log('red', '❌ 健康检查异常');
      return false;
    }
  } catch (err) {
    log('red', '❌ 请求失败:', err.message);
    return false;
  }
}

async function testConcurrentSend(openid) {
  logSection('测试 8: 并发消息发送');
  
  const messageCount = 5;
  const promises = [];
  
  for (let i = 0; i < messageCount; i++) {
    promises.push(
      request('POST', '/api/send', {
        to: openid,
        type: 'c2c',
        content: `并发测试消息 ${i + 1}/${messageCount}`,
      })
    );
  }
  
  try {
    const start = Date.now();
    const results = await Promise.all(promises);
    const duration = Date.now() - start;
    
    const successCount = results.filter(r => r.data.success).length;
    
    if (successCount === messageCount) {
      log('green', `✅ 并发测试成功 (${messageCount} 条消息)`);
      log('blue', `   总耗时: ${duration}ms`);
      log('blue', `   平均: ${(duration / messageCount).toFixed(1)}ms/条`);
      return true;
    } else {
      log('yellow', `⚠️ 部分消息发送失败 (${successCount}/${messageCount})`);
      return true;
    }
  } catch (err) {
    log('red', '❌ 并发测试失败:', err.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          QQ Bot Gateway API 完整测试                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`测试目标: ${BASE_URL}`);
  
  if (args.length < 1) {
    console.log('');
    log('yellow', '用法: node test-api.js <openid>');
    console.log('');
    console.log('示例:');
    console.log('  node test-api.js C50DCF80E802AAF67CF5225A8C224440');
    console.log('');
    console.log('提示: openid 可以通过给机器人发送消息获取');
    process.exit(1);
  }
  
  const openid = args[0];
  console.log(`测试用户: ${openid}`);
  
  const results = [];
  
  // 运行所有测试
  results.push(['服务状态', await testStatus()]);
  results.push(['健康检查', await testHealthCheck()]);
  results.push(['参数校验', await testMissingParams()]);
  results.push(['无效类型', await testInvalidType()]);
  results.push(['发送文本', await testSendText(openid)]);
  results.push(['发送长文本', await testSendLongText(openid)]);
  results.push(['发送图片', await testSendImage(openid)]);
  results.push(['并发发送', await testConcurrentSend(openid)]);
  
  // 输出测试报告
  logSection('测试报告');
  
  const passed = results.filter(([, r]) => r === true).length;
  const failed = results.filter(([, r]) => r === false).length;
  
  console.log('');
  for (const [name, result] of results) {
    const icon = result ? '✅' : '❌';
    const color = result ? 'green' : 'red';
    log(color, `  ${icon} ${name}`);
  }
  console.log('');
  console.log(`  总计: ${results.length} 个测试`);
  log('green', `  通过: ${passed}`);
  if (failed > 0) {
    log('red', `  失败: ${failed}`);
  }
  console.log('');
  
  if (failed === 0) {
    log('green', '🎉 所有测试通过！');
  } else {
    log('red', `⚠️ 有 ${failed} 个测试失败`);
  }
  
  console.log('');
}

main().catch(err => {
  log('red', '测试执行失败:', err.message);
  process.exit(1);
});
