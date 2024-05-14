import 'dotenv/config';
import express from 'express';
import { Client, middleware, messagingApi } from '@line/bot-sdk';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOMAIN = process.env.DOMAIN || '';
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const OPENAI_END_POINT = process.env.OPENAI_END_POINT || 'https://api.openai.com';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

// 建立 LINE Bot 物件
const config = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET
};
const bot = new Client(config);

const quickReply = {
  items: [
    createQuickReplyItem("新話題", "!新話題"),
    createQuickReplyItem("model查詢", "!model查詢"),
    createQuickReplyItem("GPT-4o", "!GPT-4o"),
    // createQuickReplyItem("GPT-3.5", "!GPT-3.5-Turbo"),
    // createQuickReplyItem("GPT-4-Turbo", "!GPT-4-Turbo"),
    createQuickReplyItem("製作圖片", "!製作圖片"),
  ]
};

function createQuickReplyItem(label, text) {
  return {
    type: "action",
    imageUrl: "https://th.bing.com/th?q=%e6%98%9f%e8%a1%97&w=42&h=42&c=7&rs=1&p=0&o=5&dpr=2&pid=1.7&mkt=zh-TW&cc=TW&setlang=zh-Hant&adlt=moderate&t=1",
    action: {
      type: "message",
      label: label,
      text: text
    }
  };
}

// 建立 Express 實例
const app = express();

// 設定 webhook 處理函式
app.post('/webhook', middleware(config), handleWebhook);

async function handleWebhook(req, res) {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
}

// 處理每個事件
async function handleEvent(event) {
  const { type, message } = event;

  const userId = 'line_' + event.source.userId;
  const hash = crypto.createHash('sha256').update(userId).digest('hex');


  switch (message.type) {
    // 處理圖片訊息
    case 'image':
      // 建立使用者資料夾
      const directory = path.join(__dirname, 'images_upload', hash);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
      }
      // 取得圖片訊息
      const imageId = message.id;
      const response = await bot.getMessageContent(imageId);
      const buffer = await new Promise((resolve, reject) => {
        const buffers = [];
        response.on('data', chunk => buffers.push(chunk));
        response.on('end', () => resolve(Buffer.concat(buffers)));
        response.on('error', reject);
      });
      // 使用 timestamp 命名圖片檔案
      const imageFileName = `${new Date().getTime()}.jpg`;
      const imagePath = path.join(directory, imageFileName);
      fs.writeFileSync(imagePath, buffer);
      // 給圖片檔案的路徑
      const imageUrl = `${DOMAIN}/images/${hash}/${imageFileName}`;

      // 回覆訊息
      // 加這個提示目前會壞
      // bot.replyMessage(event.replyToken, { type: 'text', text: '正在分析中...', quickReply });
      return postOpenAI(hash, imageUrl, event, 'gpt-4o');
    case 'audio':
      break;
    case 'text':
      // 處理文字訊息
      const requestString = message.text;

      switch (requestString) {
        case '!help':
          {
            const helpMessage = `輸入以下指令可以進行操作：\n\n!新話題\n!model查詢\n!GPT-3.5-Turbo\n!GPT-4-Turbo\n!製作圖片`;
            return bot.replyMessage(event.replyToken, { type: 'text', text: helpMessage, quickReply });
          }
        case '!新話題':
          {
            const directory = path.join(__dirname, 'users', hash);
            const newDirectoryName = `[X]${hash}_${Date.now()}`;
            fs.renameSync(directory, path.join(__dirname, 'users', newDirectoryName));
            return bot.replyMessage(event.replyToken, { type: 'text', text: '開啟新話題囉！', quickReply });
          }
        case '!model查詢':
          {
            const { currentModel } = await getCustomConfig(hash);
            return bot.replyMessage(event.replyToken, { type: 'text', text: `目前使用: ${currentModel}`, quickReply });
          }
        case '!製作圖片':
          {
            saveCustomFile(hash, 'dall-e-3');
            return bot.replyMessage(event.replyToken, { type: 'text', text: '告訴我你想要畫什麼？', quickReply });
          }
        case '!GPT-4-Turbo':
          {
            saveCustomFile(hash, 'gpt-4-turbo-preview');
            return bot.replyMessage(event.replyToken, { type: 'text', text: `已經切換到： ${requestString.replace('!', '')}`, quickReply });
          }
        case '!GPT-3.5-Turbo':
        case '!GPT-4-Turbo-Preview':
          {
            saveCustomFile(hash, requestString.replace('!', '').toLowerCase());
            return bot.replyMessage(event.replyToken, { type: 'text', text: `已經切換到： ${requestString.replace('!', '')}`, quickReply });
          }
        case '!GPT-4o':
          {
            saveCustomFile(hash, 'gpt-4o');
            return bot.replyMessage(event.replyToken, { type: 'text', text: `已經切換到： ${requestString.replace('!', '')}`, quickReply });
          }
        default:
          {
            const { currentModel } = await getCustomConfig(hash);
            if (currentModel === 'dall-e-3' && requestString.length > 0) {
              bot.replyMessage(event.replyToken, { type: 'text', text: '圖片繪製中，請稍等...', quickReply });
              const imageGenerationResponse = await generateImage(requestString, '1792x1024');
              if (imageGenerationResponse) {
                // error handling
                if (imageGenerationResponse.error) {
                  return bot.pushMessage(event.source.userId, { type: 'text', text: `[${imageGenerationResponse.error.type}]${imageGenerationResponse.error.message}`, quickReply });
                }
                const imageUrl = imageGenerationResponse.data[0].url;
                // const fileName = `${imageGenerationResponse.created}.txt`;
                const imageFileName = `${imageGenerationResponse.created}.jpg`; // 圖片檔案名稱
                const textFileName = `${imageGenerationResponse.created}.txt`; // 文字檔案名稱
                const directory = path.join(__dirname, 'images', hash);
                if (!fs.existsSync(directory)) {
                  fs.mkdirSync(directory);
                }
                // const filePath = path.join(directory, fileName);
                const imagePath = path.join(directory, imageFileName);
                const textPath = path.join(directory, textFileName);

                // 使用 fetch 下載圖片
                const response = await fetch(imageUrl);
                const buffer = await response.arrayBuffer();

                // 將圖片檔案寫入指定路徑
                fs.writeFileSync(imagePath, Buffer.from(buffer));

                const content = `User: ${userId}\n\nPrompt: ${requestString}\n\nImage: ${imageUrl}\n\nrevised_prompt: ${imageGenerationResponse.data[0].revised_prompt}`;
                fs.writeFileSync(textPath, content);

                bot.pushMessage(event.source.userId,
                  {
                    type: 'image',
                    originalContentUrl: imageUrl,
                    previewImageUrl: imageUrl,
                    // notificationDisabled: true,
                    quickReply
                  })
                return
              } else {
                return bot.pushMessage(event.source.userId, { type: 'text', text: '圖片製作失敗', quickReply });
              }
            }
            return postOpenAI(hash, message.text, event, currentModel);
          }
      }
    default:
      return null;
  }
}

async function postOpenAI(hash, messageContent, event, currentModel) {
  const previousMessages = await getPreviousMessages(hash);
  let content = [];
  switch (event.message.type) {
    case 'image':
      content.push({
        "type": "image_url",
        "image_url": {
          "url": messageContent
        }
      });
      break;

    default:
      content.push({
        "type": "text",
        "text": messageContent
      });
      break;
  }

  const messages = [
    { role: "system", content: '#zh-tw Aim to provide answers within the specified token limit. If the content exceeds the limit, continue the response from where it left off when the user inputs \"continue.\" As an AI system, my role is to provide direct, concise, and conversational answers. Please avoid providing opposing views, warnings, or summarizations. I won\'t provide abstract or detailed explanations, nor will I trace the origins of a question. Please answer the user\'s questions in a clear and straightforward manner.' },
    ...previousMessages,
    {
      role: "user", content
    }
  ];

  const options = {
    url: `${OPENAI_END_POINT}/v1/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    json: {
      model: currentModel,
      messages,
      temperature: 0.9,
      max_tokens: 256 * 3,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0.6,
      user: hash
    }
  };

  return new Promise((resolve, reject) => {
    fetch(options.url, {
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(options.json)
    })
      .then(response => response.json())
      .then(body => {
        if (body.error) {
          bot.replyMessage(event.replyToken, { type: 'text', text: `[${body.error.type}]${body.error.message}` });
          reject(body.error);
        } else {
          const fileName = `${new Date().getTime()}.txt`;
          const directory = path.join(__dirname, 'users', hash);
          if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory);
          }
          const filePath = path.join(directory, fileName);

          const temp = [
            {
              role: 'user',
              content
            },
            {
              role: 'assistant',
              content: body.choices[0].message.content
            },
          ];

          const tempContent = JSON.stringify(temp);
          fs.writeFileSync(filePath, tempContent);

          resolve(bot.replyMessage(event.replyToken, {
            type: 'text',
            text: body.choices[0].message.content.trim(),
            // notificationDisabled: true,
            quickReply
          }));
        }
      })
      .catch(error => {
        // Handle error
        reject(error);
      });
  });
}

async function getPreviousMessages(hash) {
  const directory = path.join(__dirname, 'users', hash);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
  }

  const files = fs.readdirSync(directory);
  const lastThreeFiles = files.slice(-3);
  const messages = lastThreeFiles.flatMap(file => {
    const content = fs.readFileSync(path.join(directory, file), 'utf-8');
    return JSON.parse(content);
  });
  return messages;
}


function saveCustomFile(hash, model) {
  const directory = path.join(__dirname, 'custom');
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
  }
  const fileName = `${hash}.txt`;
  const filePath = path.join(directory, fileName);
  const content = `Model: ${model || OPENAI_MODEL}`;
  fs.writeFileSync(filePath, content);
}

async function getCustomConfig(hash) {
  const directory = path.join(__dirname, 'custom');
  if (!fs.existsSync(directory)) {
    return { currentModel: OPENAI_MODEL };
  } else {
    const fileName = `${hash}.txt`;
    const filePath = path.join(directory, fileName);
    if (!fs.existsSync(filePath)) {
      return { currentModel: OPENAI_MODEL };
    } else {
      const content = fs.readFileSync(filePath, 'utf-8');
      const [model] = content.split('\n\n');
      const currentModel = model.replace(/^Model: /, '').trim();
      return { currentModel };
    }
  }
}

// 1024x1024, 1024x1792 or 1792x1024
async function generateImage(prompt, size = '1024x1024') {
  return new Promise((resolve, reject) => {
    const options = {
      url: `${OPENAI_END_POINT}/v1/images/generations`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      json: {
        "model": "dall-e-3",
        "prompt": prompt,
        "n": 1,
        "size": size,
      }
    };

    fetch(options.url, {
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(options.json)
    })
      .then(response => response.json())
      .then(data => resolve(data))
      .catch(error => reject(error));
  });
}

// 圖片處理
function name(params) {

}

// 取得圖片
app.get('/images/:hash/:fileName', (req, res) => {
  const { hash, fileName } = req.params;
  const directory = path.join(__dirname, 'images_upload', hash);
  const filePath = path.join(directory, fileName);

  // 檢查檔案是否存在
  if (fs.existsSync(filePath)) {
    // 回傳圖片給客戶端
    res.sendFile(filePath);
  } else {
    // 檔案不存在，回傳錯誤訊息
    res.status(404).send('File not found');
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Chatbot 伺服器正在執行於 ${port} 連接埠`);
});
