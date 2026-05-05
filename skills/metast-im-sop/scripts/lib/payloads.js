const PLATFORM_CONFIGS = {
  wx: {
    key: "wx",
    label: "personal-wechat",
    friendsPath: "/prod-api/system/api/im/getWxFrendList",
    sopPath: "/prod-api/system/api/im/sendWxSopChatMesage",
  },
  im: {
    key: "im",
    label: "wecom",
    friendsPath: "/prod-api/system/api/im/getImFrendList",
    sopPath: "/prod-api/system/api/im/sendImSopChatMesage",
  },
};

function normalizePlatform(platform = "wx") {
  const value = String(platform || "wx").trim().toLowerCase();
  if (["wx", "weixin", "wechat", "personal-wechat", "personal"].includes(value)) return "wx";
  if (["im", "wecom", "qwecom", "qiwei", "enterprise-wechat"].includes(value)) return "im";
  throw new Error(`Unsupported platform: ${platform}`);
}

function getPlatformConfig(platform = "wx") {
  return PLATFORM_CONFIGS[normalizePlatform(platform)];
}

function normalizeKind(input) {
  const value = String(input ?? "text").trim().toLowerCase();
  if (["0", "text", "emoji", "face"].includes(value)) return "text";
  if (["1", "image", "img", "picture"].includes(value)) return "image";
  if (["2", "file", "document"].includes(value)) return "file";
  if (["3", "audio", "voice", "recording"].includes(value)) return "audio";
  if (["video", "mp4"].includes(value)) return "video";
  throw new Error(`Unsupported message kind: ${input}`);
}

function requireValue(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function asString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function createMessageItem(input = {}) {
  const kind = normalizeKind(input.kind ?? input.type);
  if (kind === "text") {
    const item = {
      type: 0,
      content: asString(input.value ?? input.content ?? input.text),
    };
    if (input.htmlText !== undefined) item.htmlText = asString(input.htmlText);
    return item;
  }
  if (kind === "image") {
    const url = requireValue(input.url ?? input.value ?? input.imgUrl, "image url");
    return {
      type: 1,
      content: JSON.stringify({
        originUrl: url,
        thumbUrl: input.thumbUrl || url,
      }),
    };
  }
  if (kind === "file") {
    return {
      type: 2,
      content: JSON.stringify({
        name: requireValue(input.name, "file name"),
        size: input.size,
        url: requireValue(input.url ?? input.value, "file url"),
      }),
    };
  }
  if (kind === "audio") {
    return {
      type: 3,
      content: JSON.stringify({
        name: input.name || "",
        url: requireValue(input.url ?? input.value, "audio url"),
        duration: input.duration,
      }),
    };
  }
  throw new Error(`Unsupported SOP message item kind: ${kind}`);
}

function createSendMessageContent(input = {}) {
  const kind = normalizeKind(input.kind ?? input.type);
  if (kind === "text") {
    return {
      value: asString(input.value ?? input.content ?? input.text),
      type: "0",
    };
  }
  if (kind === "image") {
    return {
      value: requireValue(input.url ?? input.value ?? input.imgUrl, "image url"),
      type: "1",
    };
  }
  if (kind === "file") {
    return {
      value: requireValue(input.url ?? input.value, "file url"),
      name: requireValue(input.name, "file name"),
      type: "2",
    };
  }
  if (kind === "audio") {
    return {
      value: requireValue(input.url ?? input.value, "audio url"),
      duration: requireValue(input.duration, "audio duration"),
      type: "3",
    };
  }
  throw new Error(`Unsupported send message content kind: ${kind}`);
}

function buildSopTask(input = {}) {
  const sopNo = asString(input.sopNo || input.sopInfo?.sopNo || "S0").toUpperCase();
  if (!["S0", "S2", "S3"].includes(sopNo)) {
    throw new Error("-- sopNo must be S0, S2, or S3");
  }

  const contacts = input.contacts || input.concatList || [];
  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw new Error("contacts must include at least one receiver");
  }
  const events = input.events || input.eventList || input.sopInfo?.eventList || [];
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("events must include at least one message event");
  }

  const fromDuration = asString(input.fromDuration || input.sopInfo?.fromDuration || "10:00");
  const sopEndDuration = asString(input.sopEndDuration || input.endDuration || input.sopInfo?.endDuration || "10:30");
  const eventList = events.map((event) => buildSopEvent(event));
  const sopInfo = {
    sopNo,
    fromDuration,
    endDuration: sopEndDuration,
    eventList,
  };
  if (input.loopCount !== undefined || input.sopInfo?.loopCount !== undefined) {
    sopInfo.loopCount = asString(input.loopCount ?? input.sopInfo.loopCount);
  }

  return {
    sendLimit: asString(input.sendLimit || "1000"),
    sendingDate: asString(input.sendingDate || "1"),
    loopNums: asString(input.loopNums || "30"),
    fromDuration,
    endDuration: asString(input.outerEndDuration || "22:00"),
    loopStatus: Boolean(input.loopStatus || false),
    senderType: asString(input.senderType || "0"),
    sopInfo,
    taskName: requireValue(input.taskName, "taskName"),
    concatList: contacts.map((contact) => ({
      accountId: requireValue(contact.accountId, "contact.accountId"),
      friendId: requireValue(contact.friendId, "contact.friendId"),
      friendName: asString(contact.friendName),
    })),
  };
}

function buildSopEvent(event = {}) {
  const content = asString(event.cont ?? event.content ?? event.text);
  const result = {
    day: asString(event.day),
    cont: content,
  };
  if (event.type) result.type = event.type;

  if (Array.isArray(event.items)) {
    result.items = event.items.map(createMessageItem);
  } else if (content) {
    result.items = [createMessageItem({ kind: "text", value: content })];
  }
  return result;
}

function buildMoment(input = {}) {
  const platform = normalizePlatform(input.platform || "wx");
  const media = input.media || input.mediaList || [];
  if (!Array.isArray(media)) {
    throw new Error("media must be an array");
  }

  const content = asString(input.content);
  const title = asString(input.title);
  const contentUrl = asString(input.contentUrl);
  if (media.length === 0 && !content.trim() && !title.trim() && !contentUrl.trim()) {
    throw new Error("moment content, contentUrl, or media is required");
  }

  let headImage = asString(input.headImage);
  const mediaList = [];
  for (const item of media) {
    const kind = normalizeKind(item.kind ?? item.type);
    if (kind === "image") {
      mediaList.push({
        type: "1",
        imgUrl: requireValue(item.imgUrl ?? item.url, "image url"),
      });
    } else if (kind === "video") {
      mediaList.push({
        type: "2",
        videoUrl: requireValue(item.videoUrl ?? item.url, "video url"),
        videoLen: item.videoLen ?? item.duration,
      });
      if (item.coverUrl || item.headImage || item.imgUrl) {
        const coverUrl = item.coverUrl || item.headImage || item.imgUrl;
        if (platform === "wx") {
          headImage = headImage || coverUrl;
        } else {
          mediaList.push({ type: "3", imgUrl: coverUrl });
        }
      }
    } else {
      throw new Error(`Unsupported moment media kind: ${kind}`);
    }
  }

  return {
    planSendTime: Object.prototype.hasOwnProperty.call(input, "planSendTime") ? input.planSendTime : null,
    visibleType: input.visibleType ?? 1,
    headImage,
    content,
    title,
    contentUrl,
    mediaList,
    authorVids: input.authorVids || input.authors || [],
    xid: Array.isArray(input.visibleTo) ? input.visibleTo.join(",") : asString(input.xid),
  };
}

function buildSendMessageBody(input = {}) {
  return {
    sendId: requireValue(input.sendId, "sendId"),
    recvId: requireValue(input.recvId, "recvId"),
    content: createSendMessageContent(input.content || input.message || input),
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  };
}

function buildActiveStatusBody(input = {}) {
  return {
    sendId: requireValue(input.sendId, "sendId"),
    recvId: requireValue(input.recvId, "recvId"),
    status: requireValue(input.status, "status"),
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  };
}

module.exports = {
  buildActiveStatusBody,
  buildMoment,
  buildSendMessageBody,
  buildSopTask,
  createMessageItem,
  createSendMessageContent,
  getPlatformConfig,
  normalizePlatform,
};
