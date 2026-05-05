const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMoment,
  buildSopTask,
  createMessageItem,
  createSendMessageContent,
  getPlatformConfig,
} = require("../../skills/metast-im-sop/scripts/lib/payloads");

test("getPlatformConfig maps personal WeChat and WeCom endpoints", () => {
  assert.equal(getPlatformConfig("wx").friendsPath, "/prod-api/system/api/im/getWxFrendList");
  assert.equal(getPlatformConfig("wecom").sopPath, "/prod-api/system/api/im/sendImSopChatMesage");
});

test("buildSopTask creates an S0 task with fixed defaults and rich items", () => {
  const task = buildSopTask({
    sopNo: "S0",
    taskName: "任务_2026-04-30_14:59:23",
    fromDuration: "10:00",
    endDuration: "10:30",
    contacts: [{ accountId: "wxid_sender", friendId: "wxid_friend", friendName: "小威" }],
    events: [{
      type: "email",
      content: "你好[惊讶]",
      items: [
        { kind: "text", value: "你好[惊讶]" },
        { kind: "image", url: "https://lx.metast.cn/imfile/a.jpg" },
        { kind: "file", url: "https://lx.metast.cn/imfile/a.pdf", name: "报价.pdf", size: 176899 },
        { kind: "audio", url: "https://lx.metast.cn/imfile/a.wav", name: "voice.wav", duration: 5.632 },
      ],
    }],
  });

  assert.equal(task.sendLimit, "1000");
  assert.equal(task.sendingDate, "1");
  assert.equal(task.loopNums, "30");
  assert.equal(task.endDuration, "22:00");
  assert.equal(task.sopInfo.sopNo, "S0");
  assert.equal(task.sopInfo.endDuration, "10:30");
  assert.equal(task.concatList[0].friendName, "小威");
  assert.equal(task.sopInfo.eventList[0].items[0].type, 0);
  assert.equal(JSON.parse(task.sopInfo.eventList[0].items[1].content).originUrl, "https://lx.metast.cn/imfile/a.jpg");
  assert.equal(JSON.parse(task.sopInfo.eventList[0].items[2].content).name, "报价.pdf");
  assert.equal(JSON.parse(task.sopInfo.eventList[0].items[3].content).duration, 5.632);
});

test("buildSopTask supports S3 loop count and delayed events", () => {
  const task = buildSopTask({
    sopNo: "S3",
    taskName: "循环任务",
    loopCount: 20,
    contacts: [{ accountId: "sender", friendId: "friend" }],
    events: [
      { day: "", content: "第一次" },
      { day: 3, content: "第三天" },
    ],
  });

  assert.equal(task.sopInfo.loopCount, "20");
  assert.equal(task.sopInfo.eventList[1].day, "3");
  assert.deepEqual(task.sopInfo.eventList[1].items, [{ type: 0, content: "第三天" }]);
});

test("buildMoment uses wx headImage for video cover and im media type 3 for video cover", () => {
  const wxMoment = buildMoment({
    platform: "wx",
    content: "测[呲牙]",
    authorVids: ["wxid_sender"],
    media: [{ kind: "video", url: "https://lx.metast.cn/video.mp4", coverUrl: "https://lx.metast.cn/cover.jpg", videoLen: 10 }],
  });
  const imMoment = buildMoment({
    platform: "im",
    content: "测[呲牙]",
    authorVids: ["1688857486393533"],
    media: [{ kind: "video", url: "https://lx.metast.cn/video.mp4", coverUrl: "https://lx.metast.cn/cover.jpg", videoLen: 10 }],
  });

  assert.equal(wxMoment.headImage, "https://lx.metast.cn/cover.jpg");
  assert.deepEqual(wxMoment.mediaList, [{ type: "2", videoUrl: "https://lx.metast.cn/video.mp4", videoLen: 10 }]);
  assert.equal(imMoment.headImage, "");
  assert.deepEqual(imMoment.mediaList, [
    { type: "2", videoUrl: "https://lx.metast.cn/video.mp4", videoLen: 10 },
    { type: "3", imgUrl: "https://lx.metast.cn/cover.jpg" },
  ]);
});

test("buildMoment allows text-only moments", () => {
  const moment = buildMoment({
    platform: "wx",
    content: "纯文本朋友圈测试",
    authorVids: ["wxid_sender"],
    visibleTo: ["wxid_friend"],
  });

  assert.equal(moment.content, "纯文本朋友圈测试");
  assert.deepEqual(moment.mediaList, []);
  assert.equal(moment.xid, "wxid_friend");
});

test("createMessageItem and createSendMessageContent encode the two rich-message formats", () => {
  assert.deepEqual(createMessageItem({ kind: "text", value: "111" }), { type: 0, content: "111" });
  assert.deepEqual(createSendMessageContent({ kind: "file", url: "https://lx.metast.cn/a.pdf", name: "a.pdf" }), {
    value: "https://lx.metast.cn/a.pdf",
    name: "a.pdf",
    type: "2",
  });
});
