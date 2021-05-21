const { MD5, enc } = require('crypto-js')

const isDebug = false;

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Referrer': 'https://www.superbed.cn/'
}

/**
 * 向调试服务器发送信息
 * @param {*} data 
 */
let debug = async function(data) {
  if (!isDebug) {
    return;
  }

  await this.Request.request({
    method: 'POST',
    url: 'http://127.0.0.1:3000/',
    body: data,
    json: false,
    headers: {
      'Content-Type': 'text/plain'
    }
  })
}

/**
 * 发送通知
 * @param {*} title 
 * @param {*} body 
 */
let sendNotification = function (title, body) {
  this.emit('notification', {
    title, body
  })
}

/**
 * 获取上传器配置
 * @param {} ctx 
 * @returns {{token: string, username: string, password: string}}
 */
function getUploaderConfig(ctx) {
  return ctx.getConfig('picBed.superbed')
}

/**
 * 登录
 * @param {*} ctx 
 * @returns {Promise<string>} Token
 */
async function signIn(ctx) {
  await debug('准备登陆')
  const { username, password } = getUploaderConfig(ctx)
  // 登录
  const resp = await ctx.Request.request({
    method: 'POST',
    url: 'https://www.superbed.cn/signin',
    form: {
      username,
      password,
      remember: 'on'
    },
    headers: COMMON_HEADERS
  });

  await debug(`登录响应：${resp}`)

  data = JSON.parse(resp)

  if (data.err !== 0) {
    // 登录失败
    throw new Error(`登录失败：${data.msg}`)
  }

  return data.user.token;
}

/**
 * 获取上传设置
 * @param {*} ctx 
 * @param {*} token
 * @returns {Promise<{url: string, ts: number, token: string, active: boolean}>}
 */
async function requestUploadSetting(ctx, token) {
  await debug(`获取上传配置`)
  const resp = await ctx.Request.request({
    method: 'GET',
    url: 'https://www.superbed.cn/?code=1',
    headers: {
      'Cookie': `token=${token}`,
      ...COMMON_HEADERS
    }
  })
  await debug(`上传配置：${resp}`)
  return JSON.parse(resp)
}

/**
 * 制造表单数据
 * @param {{file: Buffer, filename: string}[]} images 
 * @param {string} token
 */
async function makeFormData(ctx, images, token, ts) {
  const formData = {
    nonce: 646703147,
    ts,
    token,
    sign: '',
    _xsrf: '',
    endpoints: 'superbed',
    categories: ''
  }

  formData.sign = MD5(`${token}_${ts}_${formData.nonce}`).toString(enc.Hex)

  await debug(`表单初始化数据：${JSON.stringify(formData)}`)

  for (let i = 0; i < images.length; i++) {
    formData[`file${i}`] = {
      value: images[i].file,
      options: {
        filename: images[i].filename
      }
    };
  }

  return formData;
}

/**
 * 查询实际链接
 * @param {*} ctx 
 * @param {string} forward 
 * @param {string[]} ids 
 */
async function getRealUrl(ctx, forward, ids) {
  await debug(`准备查询实际链接`)
  const resp = await ctx.Request.request({
    method: 'GET',
    url: `https://www.superbed.cn/?forward=${encodeURIComponent(forward)}&ids=${ids.join(',')}`,
    headers: COMMON_HEADERS
  })
  
  await debug(`实际链接：${resp}`)
  const data = JSON.parse(resp)

  if (data.err !== 0) {
    throw new Error(`查询实际链接失败：${data.msg}`)
  }

  return data.results
}

/**
 * 免费用户上传
 * @param {*} ctx 
 */
async function freeUpload(ctx) {
  await debug('免费用户上传')
  try {
    // 登录
    const token = await signIn(ctx);

    // 获取上传设置
    const uploadSettings = await requestUploadSetting(ctx, token)

    // 获取表单数据
    const images = ctx.output.map(item => {
      const body = item.buffer;
      if (!body && item.base64Image) {
        body = Buffer.from(item.base64Image, 'base64')
      }

      return {
        file: body,
        filename: `${item.fileName}`
      }
    })
    const formData = await makeFormData(ctx, images, token, uploadSettings.ts)

    // 上传
    const resp = await ctx.Request.request({
      method: 'POST',
      url: uploadSettings.url,
      formData,
      headers: {
        Cookie: `token=${token}`,
        ...COMMON_HEADERS
      }
    });

    const data = JSON.parse(resp)

    if (data.err !== 0) {
      throw new Error(`上传图片失败：${data.msg}`)
    }

    // 查询实际链接
    const realLinks = await getRealUrl(ctx, data.forward, data.ids)

    // 设置图片 URL
    const ids = data.ids;
    for (let i = 0; i < ctx.output.length; i++) {
      ctx.output[i].imgUrl = realLinks[ids[i]].url
    }
  } catch (err) {
    sendNotification('聚合图床上传图片失败', `${err.message}\n${err.stack}`)
  }
}


/**
 * 付费用户上传
 * @param {*} ctx 
 * @returns 
 */
async function payUploader(ctx) {
  await debug('付费用户上传')
  
  const config = getUploaderConfig(ctx)

  try {
    const formData = {}

    ctx.output.forEach((item, i) => {
      const body = item.buffer;
      if (!body && item.base64Image) {
        body = Buffer.from(item.base64Image, 'base64')
      }

      formData[`file${i}`] = {
        value: body,
        options: {
          filename: item.fileName
        }
      }
    });

    await debug('开始上传图片')

    const resp = await ctx.Request.request({
      method: 'POST',
      url: `https://api.superbed.cn/upload?token=${config.token}`,
      formData
    });

    const data = JSON.parse(resp)

    await debug(`上传图片完成：${resp}`)

    if (data.err !== 0) {
      throw new Error(`图片上传失败：${data.msg}`)
    }

    // 设置链接
    Object.values(data.urls).forEach((u, i) => {
      ctx.output[i].imgUrl = u;
    })
  } catch (err) {
    sendNotification('聚合图床上传图片失败', String(err))
  }
  
}

const handle = async ctx => {
  const config = getUploaderConfig(ctx)
  await debug(`用户配置：${JSON.stringify(config)}`)

  if (config.token) {
    // 付费用户上传
    await payUploader(ctx)
  } else if (config.username && config.password) {
    // 免费用户上传
    await freeUpload(ctx)
  } else {
    // 无有效凭据
    sendNotification('聚合图床上传失败：凭据不足', '请提供 token（付费用户） 或 (username 和 password)（免费用户）')
  }
}

module.exports = ctx => {
  const register = () => {
    // 发送通知绑定 this -> ctx
    sendNotification = sendNotification.bind(ctx)
    debug = debug.bind(ctx)

    ctx.helper.uploader.register('superbed', { 
      handle, 
      name: '聚合图床',
      config: () => {
        config = ctx.getConfig('picBed.superbed')
        return [
          {
            name: "token",
            required: false,
            type: 'input',
            message: '付费用户：Token（用户中心获取），设置后优先使用',
            default: config.token
          },
          {
            name: 'username',
            required: false,
            type: 'input',
            message: '免费用户：用户名',
            default: config.username
          },
          {
            name: 'password',
            required: false,
            type: 'password',
            message: '免费用户：密码',
            default: ''
          }
        ]
      },
    })
  }
  return {
    register,
    uploader: 'superbed'
  }
}
