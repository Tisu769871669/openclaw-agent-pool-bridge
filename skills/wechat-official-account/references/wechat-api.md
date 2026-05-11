# 微信公众号 API 参考

本技能优先使用微信公众平台官方 API。

## 关键接口

- 获取 access_token：`GET /cgi-bin/token`
- 新增草稿：`POST /cgi-bin/draft/add`
- 发布草稿：`POST /cgi-bin/freepublish/submit`
- 查询发布状态：`POST /cgi-bin/freepublish/get`
- 群发通知草稿：`POST /cgi-bin/message/mass/sendall`
- 查询群发状态：`POST /cgi-bin/message/mass/get`
- 上传永久素材：`POST /cgi-bin/material/add_material`

## 本地能力参考来源

- 微信官方草稿产品说明：https://developers.weixin.qq.com/doc/subscription/guide/product/draft.html
- 微信官方发布能力：https://developers.weixin.qq.com/doc/offiaccount/Publish/Publish.html
- 微信官方群发接口：https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Batch_Sends_and_Originality_Checks.html
- 公众号 Markdown 排版参考：https://github.com/geekjourneyx/md2wechat-skill
- 公众号文章技能参考：https://github.com/BND-1/wechat_article_skills
- 内容运营工作流参考：https://github.com/autoclaw-cc/xiaohongshu-skills

## 模式边界

- `draft-only` 只创建草稿，不公开展示，不通知粉丝。
- `publish` 使用 `freepublish/submit`，进入微信后台发表记录，可能显示为“未通知”。
- `notify` 使用 `message/mass/sendall`，会群发通知粉丝并消耗公众号群发额度。
- 已经 `freepublish/submit` 的 `media_id` 不能直接复用到 `message/mass/sendall`；需要基于文章包重新创建草稿再群发。
- `message/mass/sendall` 返回 `45028 has no masssend quota` 时，表示当前账号群发通知额度不足，代码不应重试刷额度。

## 常见问题

- `invalid credential`：检查 AppID、AppSecret、IP 白名单。
- `access_token expired`：重新获取 token。
- 素材上传失败：检查文件格式、大小、账号权限。
- 发布失败：先查询 publish status，再看微信返回的 errcode/errmsg。
- 群发失败：先看 errcode；`40007 invalid media_id` 通常表示传入的不是可群发草稿 media_id；`45028` 表示群发额度不足。

## 凭证

凭证通过环境变量传入：

```env
WECHAT_MP_APP_ID=
WECHAT_MP_APP_SECRET=
```

不要把真实值提交到仓库。
