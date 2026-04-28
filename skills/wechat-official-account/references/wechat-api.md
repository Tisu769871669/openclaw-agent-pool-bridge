# 微信公众号 API 参考

本技能优先使用微信公众平台官方 API。

## 关键接口

- 获取 access_token：`GET /cgi-bin/token`
- 新增草稿：`POST /cgi-bin/draft/add`
- 发布草稿：`POST /cgi-bin/freepublish/submit`
- 查询发布状态：`POST /cgi-bin/freepublish/get`
- 上传永久素材：`POST /cgi-bin/material/add_material`

## 常见问题

- `invalid credential`：检查 AppID、AppSecret、IP 白名单。
- `access_token expired`：重新获取 token。
- 素材上传失败：检查文件格式、大小、账号权限。
- 发布失败：先查询 publish status，再看微信返回的 errcode/errmsg。

## 凭证

凭证通过环境变量传入：

```env
WECHAT_MP_APP_ID=
WECHAT_MP_APP_SECRET=
```

不要把真实值提交到仓库。
