const fs = require('fs-extra')
const path = require('path')
// const request = require('request')
const got = require('got')
const Lz4 = require('../util/lz4.js')

// const gameHostBase = 'http://storage.game.starlight-stage.jp/dl/resources'
const gameHostBase = 'https://asset-starlight-stage.akamaized.net/dl/resources'
const imgHostBase = 'https://hidamarirhodonite.kirara.ca'

class Downloader {
  constructor () {
    this.tasks = []
    this.req = null
    this.index = -1
    this.isContinue = true
    this.rename = true
  }

  downloadOne (u, p, onData) {
    return new Promise((resolve, reject) => {
      fs.mkdirsSync(path.dirname(p))
      if (fs.existsSync(p)) return resolve(p)

      const headers = {
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 7.0; Nexus 42 Build/XYZZ1Y)',
        'X-Unity-Version': '2018.3.8f1',
        'Accept-Encoding': 'gzip',
        'Connection': 'Keep-Alive'
      }
      let fileLength = 0
      if (fs.existsSync(p + '.tmp')) {
        fileLength = fs.statSync(p + '.tmp').size
        if (fileLength > 0) {
          headers.Range = 'bytes=' + fileLength + '-'
        }
      }

      // let rename = true
      // let size = 0
      this.rename = true
      let start = 0
      let contentLength = 0

      const targetStream = fs.createWriteStream(p + '.tmp', { flags: 'a+' }).on('close', () => {
        const tmpFileSize = fs.statSync(p + '.tmp').size
        if (tmpFileSize === 0) {
          fs.removeSync(p + '.tmp')
          resolve('')
          return
        }

        if (this.rename && tmpFileSize === fileLength + contentLength) {
          fs.renameSync(p + '.tmp', p)
          resolve(p)
        } else {
          resolve('')
        }
      }).on('error', (err) => {
        if (err) {
          this.rename = false
          this.req = null
          reject(err)
        }
      })

      const downloadStream = got.stream(u, {
        method: 'GET',
        headers,
        timeout: {
          response: 10000
        },
        encoding: null,
        useElectronNet: !!process.versions.electron
      })

      downloadStream.on('error', (err) => {
        this.rename = false
        this.req = null
        targetStream.close()
        reject(err)
      })

      downloadStream.on('request', (req) => {
        this.req = req
        this.rename = true
      })

      downloadStream.on('response', (res) => {
        contentLength = Number(res.headers['content-length']) || 0
        start = new Date().getTime()
      })

      downloadStream.on('downloadProgress', (progress) => {
        if (typeof onData === 'function') {
          if (fileLength + progress.transferred === fileLength + progress.total) {
            onData({
              name: path.parse(p).base,
              current: fileLength + progress.transferred,
              max: fileLength + progress.total,
              loading: 100 * (fileLength + progress.transferred) / (fileLength + progress.total)
            })
          } else {
            const now = new Date().getTime()
            if (now - start > 100) {
              start = now
              onData({
                name: path.parse(p).base,
                current: fileLength + progress.transferred,
                max: fileLength + progress.total,
                loading: 100 * (fileLength + progress.transferred) / (fileLength + progress.total)
              })
            }
          }
        }
      })

      downloadStream.pipe(targetStream)

      // this.req = request.get({
      //   url: u,
      //   headers: headers,
      //   timeout: 10000,
      //   encoding: null
      // })
      // this.req.on('response', (res) => {
      //   if (res.statusCode >= 400) {
      //     reject(new Error('Download failed. Code: ' + res.statusCode))
      //     return
      //   }
      //   const contentLength = Number(res.headers['content-length'])
      //   let start = new Date().getTime()
      //   this.req.on('data', (chunk) => {
      //     size += chunk.length
      //     if (typeof onData === 'function') {
      //       if (fileLength + size === fileLength + contentLength) {
      //         onData({
      //           name: path.parse(p).base,
      //           current: fileLength + size,
      //           max: fileLength + contentLength,
      //           loading: 100 * (fileLength + size) / (fileLength + contentLength)
      //         })
      //       } else {
      //         const now = new Date().getTime()
      //         if (now - start > 100) {
      //           start = now
      //           onData({
      //             name: path.parse(p).base,
      //             current: fileLength + size,
      //             max: fileLength + contentLength,
      //             loading: 100 * (fileLength + size) / (fileLength + contentLength)
      //           })
      //         }
      //       }
      //     }
      //   })

      //   this.req.pipe(fs.createWriteStream(p + '.tmp', { flags: 'a+' }).on('close', () => {
      //     if (rename) {
      //       fs.renameSync(p + '.tmp', p)
      //       resolve(p)
      //     }
      //   }).on('error', (err) => {
      //     if (err) {
      //       rename = false
      //       reject(err)
      //     }
      //   }))
      // })
      // this.req.on('abort', () => {
      //   rename = false
      //   resolve('')
      // })
      // this.req.on('error', err => {
      //   rename = false
      //   reject(err)
      // })
    })
  }

  async download (tasks, start, onData, complete, stop) {
    this.tasks = tasks
    this.index = 0
    this.isContinue = true

    let errorList = []

    for (this.index = 0; this.index < this.tasks.length; this.index++) {
      let url = this.tasks[this.index][0]
      let filepath = this.tasks[this.index][1]

      if (start && !fs.existsSync(filepath)) start(this.tasks[this.index])
      try {
        await this.downloadOne(url, filepath, onData)
      } catch (e) {
        errorList.push(filepath)
        this.isContinue = false
      }

      if (this.isContinue) {
        if (complete) complete(this.tasks[this.index])
      } else {
        if (stop) stop(this.tasks[this.index])
      }
    }
    this.tasks = []
    this.index = -1
    this.isContinue = true
    this.req = null
    return errorList
  }

  async batchDownload (manifests, targetDir, start, onData, complete, stop) {
    this.tasks = manifests
    this.index = 0
    this.isContinue = true

    let errorList = []

    for (this.index = 0; this.index < this.tasks.length; this.index++) {
      const { name, hash } = this.tasks[this.index]
      const ext = path.extname(name)
      const p = path.join(targetDir, path.basename(name, ext !== '.acb' ? ext : ''))

      if (start && !fs.existsSync(p)) start(this.tasks[this.index], p)
      if (ext === '.acb') {
        try {
          await this.downloadSound(path.dirname(name), hash, p, onData)
        } catch (e) {
          errorList.push(p)
          this.isContinue = false
        }
      } else if (ext === '.unity3d') {
        try {
          await this.downloadAsset(hash, p, onData)
        } catch (e) {
          errorList.push(p)
          this.isContinue = false
        }
      } else if (ext === '.bdb' || ext === '.mdb') {
        try {
          await this.downloadDatabase(hash, p, onData, ext)
        } catch (e) {
          errorList.push(p)
          this.isContinue = false
        }
      } else {
        continue
      }

      if (this.isContinue) {
        if (complete) complete(this.tasks[this.index], p)
      } else {
        if (stop) stop(this.tasks[this.index], p)
      }
    }

    this.tasks = []
    this.index = -1
    this.isContinue = true
    this.req = null
    return errorList
  }

  stop (stopCallback) {
    this.isContinue = false
    if (this.tasks.length) {
      this.tasks = []
    } else {
      if (stopCallback) stopCallback()
    }
    if (this.req) {
      this.req.abort()
      this.rename = false
      this.req = null
    }
  }

  downloadManifest (resVer, p, onData) {
    return this.downloadOne(`https://asset-starlight-stage.akamaized.net/dl/${resVer}/manifests/Android_AHigh_SHigh`, p, onData).then(p => p && Lz4.decompress(p, '.db'))
  }

  downloadAsset (hash, p, onData) {
    // return this.downloadOne(`${gameHostBase}/High/AssetBundles/Android/${hash}`, p, onData).then(p => p && Lz4.decompress(p, '.unity3d'))
    return this.downloadOne(`${gameHostBase}/AssetBundles/${hash.substr(0, 2)}/${hash}`, p, onData).then(p => p && Lz4.decompress(p, '.unity3d'))
  }

  downloadSound (k, hash, p, onData) {
    return this.downloadOne(`${gameHostBase}/Sound/${hash.substr(0, 2)}/${hash}`, p, onData)
  }

  downloadDatabase (hash, p, onData, suffix = '.bdb') {
    return this.downloadOne(`${gameHostBase}/Generic/${hash.substr(0, 2)}/${hash}`, p, onData).then(p => p && Lz4.decompress(p, suffix))
  }

  downloadSpread (id, p, onData) {
    return this.downloadOne(`${imgHostBase}/spread/${id}.png`, p, onData)
  }

  downloadIcon (id, p, onData) {
    return this.downloadOne(`${imgHostBase}/icon_card/${id}.png`, p, onData)
  }
}

module.exports = Downloader
