#!/usr/bin/env node

require('dotenv').config();

console.log('=== Google Sheets認証環境変数検証 ===\n');

// 必要な環境変数のチェック
const requiredVars = [
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_SHEETS_SPREADSHEET_ID'
];

let hasErrors = false;

// 環境変数の存在チェック
console.log('1. 環境変数の存在チェック:');
for (const varName of requiredVars) {
  const value = process.env[varName];
  if (!value || value.trim() === '') {
    console.log(`  ❌ ${varName}: 未設定または空`);
    hasErrors = true;
  } else {
    console.log(`  ✅ ${varName}: 設定済み (長さ: ${value.length}文字)`);
  }
}

console.log('\n2. GOOGLE_PRIVATE_KEY の詳細分析:');
const privateKey = process.env.GOOGLE_PRIVATE_KEY;

if (privateKey) {
  console.log(`  - 全体の長さ: ${privateKey.length}文字`);
  console.log(`  - 改行文字 (\\n) を含む: ${privateKey.includes('\n') ? 'はい' : 'いいえ'}`);
  console.log(`  - エスケープされた改行 (\\\\n) を含む: ${privateKey.includes('\\n') ? 'はい' : 'いいえ'}`);
  console.log(`  - BEGIN PRIVATE KEY を含む: ${privateKey.includes('-----BEGIN PRIVATE KEY-----') ? 'はい' : 'いいえ'}`);
  console.log(`  - END PRIVATE KEY を含む: ${privateKey.includes('-----END PRIVATE KEY-----') ? 'はい' : 'いいえ'}`);
  console.log(`  - BEGIN RSA PRIVATE KEY を含む: ${privateKey.includes('-----BEGIN RSA PRIVATE KEY-----') ? 'はい' : 'いいえ'}`);
  
  // 最初と最後の50文字を表示（秘密鍵の構造確認用）
  console.log(`  - 最初の50文字: ${privateKey.substring(0, 50)}...`);
  console.log(`  - 最後の50文字: ...${privateKey.substring(privateKey.length - 50)}`);
  
  // PEM形式の検証
  if (!privateKey.includes('-----BEGIN') || !privateKey.includes('-----END')) {
    console.log('\n  ⚠️  警告: PEMヘッダー/フッターが見つかりません');
    console.log('  秘密鍵は以下の形式である必要があります:');
    console.log('  -----BEGIN PRIVATE KEY-----');
    console.log('  [Base64エンコードされた鍵データ]');
    console.log('  -----END PRIVATE KEY-----');
  }
  
  // 改行文字の問題
  if (!privateKey.includes('\n') && privateKey.includes('\\n')) {
    console.log('\n  ⚠️  警告: エスケープされた改行文字が検出されました');
    console.log('  環境変数設定時に改行文字が正しくエンコードされていない可能性があります。');
  }
} else {
  console.log('  ❌ GOOGLE_PRIVATE_KEY が未設定です');
}

console.log('\n3. 認証テスト:');
if (!hasErrors && privateKey) {
  try {
    // google-auth-libraryでの認証テスト
    const { GoogleAuth } = require('google-auth-library');
    
    // 秘密鍵の正規化
    let normalizedKey = privateKey;
    
    // エスケープされた改行を実際の改行に変換
    if (normalizedKey.includes('\\n')) {
      normalizedKey = normalizedKey.replace(/\\n/g, '\n');
      console.log('  - エスケープされた改行文字を変換しました');
    }
    
    // PEMヘッダー/フッターがない場合は追加
    if (!normalizedKey.includes('-----BEGIN') && !normalizedKey.includes('-----END')) {
      normalizedKey = `-----BEGIN PRIVATE KEY-----\n${normalizedKey.trim()}\n-----END PRIVATE KEY-----`;
      console.log('  - PEMヘッダー/フッターを追加しました');
    }
    
    const auth = new GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: normalizedKey
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    console.log('  - GoogleAuth オブジェクトの作成: ✅ 成功');
    
    // 実際に認証を試行
    auth.getClient()
      .then(() => {
        console.log('  - 認証テスト: ✅ 成功！');
        console.log('\n✅ すべての検証が成功しました。環境変数は正しく設定されています。');
      })
      .catch(error => {
        console.log('  - 認証テスト: ❌ 失敗');
        console.log(`  エラー: ${error.message}`);
        if (error.code === 'ERR_OSSL_UNSUPPORTED') {
          console.log('\n  💡 解決方法:');
          console.log('  1. サービスアカウントのJSONファイルから秘密鍵を再度コピーしてください');
          console.log('  2. 環境変数設定時に改行文字が正しく保持されるようにしてください');
          console.log('  3. Dockerやクラウドサービスを使用している場合は、それぞれのドキュメントを確認してください');
        }
      });
    
  } catch (error) {
    console.log(`  ❌ エラー: ${error.message}`);
  }
} else {
  console.log('  スキップ: 必要な環境変数が不足しています');
}

console.log('\n=== 検証完了 ===');