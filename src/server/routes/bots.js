const express = require("express");
const ms = require("ms");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const router = express.Router();

router.get("/", async (req, res) => {
  let bots = await botModel.find({
    status: "approved",
  });

  for (let i = 0; i < bots.length; i++) {
    bots[i].tags = bots[i].tags.join(", ");
  }

  let user = await userModel.findOne({ revoltId: req.session.userAccountId });
  if (user) {
    let userRaw = await client.users.fetch(user.revoltId);
    user.username = userRaw.username;
    user.avatar = userRaw.avatar;
  }
  res.render("index.ejs", {
    bots,
    user,
  });
});

router.get("/submit", checkAuth, async (req, res) => {
  let user = await userModel.findOne({ revoltId: req.session.userAccountId });
  if (user) {
    let userRaw = await client.users.fetch(user.revoltId);
    user.username = userRaw.username;
    user.avatar = userRaw.avatar;
  }
  res.render("bots/submit.ejs", {
    user,
    tags: config.tags,
  });
});

router.post("/submit", checkAuth, async (req, res) => {
  const data = req.body;
  if (!data)
    return res.status(400).json("You need to provide the bot's information.");
  if (await botModel.findOne({ id: data.botid }))
    return res.status(409).json({ message: "This bot is already added." });
  let BotRaw = await client.bots.fetchPublic(data.botid).catch((err) => {
    console.log(err);
  });
  if (!BotRaw)
    return res.status(400).json({
      message:
        "The provided bot couldn't be found on Revolt OR it's a private bot, make it public to add it.",
    });

  if (data.owners) {
    let owners = [];
    owners.push(req.session.userAccountId);

    data.owners.split(" ").forEach((owner) => {
      owners.push(owner);
    });
    data.owners = owners;
  } else {
    data.owners = [];
    data.owners.push(req.session.userAccountId);
  }
  if (data.owners) {
    data.owners.forEach(async (owner) => {
      try {
        await client.users.get(owner);
      } catch (e) {
        return res.status(409).json({
          message:
            "One of your owners is not a real user, or isn't in our server.",
        });
      }
    });
  }

  let UserRaw = await client.users.fetch(req.params.id).catch((err) => {
    console.log(err);
  });
  if (!UserRaw)
    return res.status(400).json({
      message:
        "Couldn't find the bot on Revolt.",
    });

  await botModel
    .create({
      id: data.botid,
      name: BotRaw.username,
      iconURL: `https://autumn.revolt.chat/avatars/${UserRaw.avatar._id}/${UserRaw.avatar.filename}`,
      prefix: data.prefix,
      shortDesc: data.shortDesc,
      description: data.desc,
      website: data.website || null,
      github: data.github || null,
      support: data.support || null,
      library: data.library,
      tags: data.tags,
      owners: data.owners,
      submittedOn: Date.now(),
    })
    .then(async () => {
      res.status(201).json({ message: "Added to queue", code: "OK" });
      let logs = client.channels.get(config.channels.weblogs);
      logs.sendMessage(
        `<@${req.session.userAccountId}> has submitted **${BotRaw.username}** to the list.\n<https://revoltbots.org/bot/${data.botid}>`
      );
    });
});

router.get("/certify", checkAuth, async (req, res) => {
  let user = await userModel.findOne({ revoltId: req.session.userAccountId });
  let bots = await botModel.find({ owners: { $all: [req.session.userAccountId] } });

  if (user) {
    let userRaw = await client.users.fetch(user.revoltId);
    user.username = userRaw.username;
    user.avatar = userRaw.avatar;
    user.id = user.revoltId;
  }

  res.render("bots/certify.ejs", {
    user: user || null,
    botclient: client,
    bots,
  });
});

router.post("/certify", checkAuth, async (req, res) => {
  const botDb = botModel.findOne({ id: req.body.bot });
  if (!botDb) return res.status(404).json({ message: "Bot not found." });

  if (botDb.certifyApplied) return res.status(409).json({ message: "You already applied for certification." });

  botDb.updateOne({ certifyApplied: true }).then(() => {
    res.status(200).json({ message: "Applied for certification! You'll be notified once your application is looked over." });
  });
});

router.post("/:id/apikey", checkAuth, async (req, res) => {
  let id = req.params.id;
  let bot = await botModel.findOne({ id: id });
  if (!bot) return res.redirect("/");
  if (!bot.owners.includes(req.session.userAccountId)) return res.redirect("/");

  let data = req.body;
  function genApiKey(options = {}) {
    let length = options.length || 5;
    let string =
      "abcdefghijklmnopqrstuwvxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    let code = "";
    for (let i = 0; i < length; i++) {
      let random = Math.floor(Math.random() * string.length);
      code += string.charAt(random);
    }
    return code;
  }
  bot.apikey = genApiKey({ length: 20 });
  await bot.save();
  return res.redirect(
    `/bots/${id}/edit?success=true&body=You have successfully generated a new token.`
  );
});

router.get("/:id", async (req, res) => {
  let approved =
    (await botModel.findOne({ id: req.params.id, status: "approved" })) ||
    (await botModel.findOne({
      vanity: { $regex: `${req.params.id}`, $options: "i" },
      status: "approved",
      certified: true,
    }));
  let awaiting = await botModel.findOne({
    id: req.params.id,
    status: "awaiting",
  });
  let isStaff = await userModel.findOne({
    revoltId: req.session.userAccountId,
    isStaff: true,
  });
  let user = await userModel.findOne({ revoltId: req.session.userAccountId });
  if (user) {
    let userRaw = await client.users.fetch(user.revoltId);
    user.username = userRaw.username;
    user.avatar = userRaw.avatar;
    user.id = user.revoltId;
  }
  if (req.params.id == "search")
    return res.render("explore.ejs", { user: user, bots: null, error: null });
  if (
    (!approved && !awaiting) ||
    (awaiting &&
      !isStaff &&
      !awaiting.owners.includes(req.session.userAccountId))
  )
    return res.status(404).json({
      message: "This bot could not be found on our list or is not approved.",
    });
  const status = {
  "Online": "#3ABF7E",
  "Idle": "#F39F00",
  "Focus": "#4799F0",
  "Busy": "#F84848",
  "Invisible": "#A5A5A5",
  "Offline": "#A5A5A5"
  }
  let bot = awaiting || approved;
  const marked = require("marked");
  const description = marked.parse(bot.description);
  let BotRaw = await client.users.fetch(req.params.id).catch(() => null);
  if (BotRaw) {
    bot.Status = BotRaw.status.presence || null;
    bot.statusColor = status[BotRaw.status.presence] || null;
  }
  bot.description = description;
  bot.tags = bot.tags.join(", ");
  res.render("bots/view.ejs", {
    user: user || null,
    botclient: client,
    bot,
  });
});

router.get("/:id/edit", checkAuth, async (req, res) => {
  let bot = await botModel.findOne({ id: req.params.id });
  if (!bot || bot == null)
    return res
      .status(404)
      .json({ message: "This bot could not be found on our list." });
  if (!bot.owners.includes(req.session.userAccountId)) return res.redirect("/");
  let user = await userModel.findOne({ revoltId: req.session.userAccountId });

  if (user) {
    let userRaw = await client.users.fetch(user.revoltId);
    user.username = userRaw.username;
    user.avatar = userRaw.avatar;
    user.id = user.revoltId;
  }

  res.render("bots/edit.ejs", {
    user: user || null,
    botclient: client,
    tags: config.tags,
    bot,
  });
});

router.post("/:id/edit", checkAuth, async (req, res) => {
  const data = req.body;
  if (!data)
    return res.status(400).json("You need to provide the bot's information.");
  let bot = await botModel.findOne({ id: req.params.id });
  if (data.vanity) {
	let botvanity = await botModel.findOne({ vanity: { $regex: `${data.vanity}`, $options: "i" } });
	if (botvanity !== null && botvanity.id !== req.params.id) return res.status(400).json({
		message: "The Provided vanity is already taken!"
	})
  }
  if (!bot)
    return res
      .status(404)
      .json({ message: "This bot could not be found on our list." });
 if (!bot.owners.includes(req.session.userAccountId)) return res.redirect("/");
  let BotRaw = await client.users.fetch(req.params.id).catch((err) => {
    console.log(err);
  });
  if (!BotRaw)
    return res.status(400).json({
      message:
        "The provided bot couldn't be found on Revolt OR it's a private bot, make it public to add it.",
    });

  if (data.owners) {
    let owners = [];
    owners.push(req.session.userAccountId);

    data.owners.split(" ").forEach((owner) => {
      owners.push(owner);
    });
    data.owners = owners;
  }
  console.log(BotRaw)
  if (data.owners) {
    data.owners.forEach(async (owner) => {
      try {
        await client.users.get(owner);
      } catch (e) {
        return res.status(409).json({
          message:
            "One of your owners is not a real user, or isn't in our server.",
        });
      }
    });
  }
  (bot.name = BotRaw.username),
    (bot.iconURL = `https://autumn.revolt.chat/avatars/${BotRaw.avatar._id}/${BotRaw.avatar.filename}`),
    (bot.prefix = data.prefix);
  bot.website = data.website;
  bot.github = data.github;
  bot.vanity = data.vanity || null;
  bot.description = data.desc;
  bot.shortDesc = data.shortDesc;
  bot.support = data.support || null;
  bot.libary = data.libary;
  bot.tags = data.tags;
  if (bot)
  if (data.owners) bot.owners = data.owners;
  await bot.save().then(async () => {
    res.status(201).json({ message: "Successfully Edited", code: "OK" });
    let logs = client.channels.get(config.channels.weblogs);
    logs.sendMessage(
      `<\@${req.session.userAccountId}> edited **${BotRaw.username}**.\n<https://revoltbots.org/bots/${data.botid}>`
    );
  });
});

router.get("/:id/vote", async (req, res) => {
  let bot = await botModel.findOne({ id: req.params.id });
  if (!bot)
    return res
      .status(404)
      .json({ message: "This bot could not be found on our list." });
  let user = await userModel.findOne({ revoltId: req.session.userAccountId });
  if (user) {
    let userRaw = await client.users.fetch(user.revoltId);
    user.username = userRaw.username;
    user.avatar = userRaw.avatar;
    user.id = user.revoltId;
  }

  res.render("bots/vote.ejs", {
    user: user || null,
    bot,
  });
});

router.post("/search", async (req, res) => {
  let botDesc = await botModel.find({
    status: "approved",
    description: { $regex: `${req.body.q}`, $options: "i" },
  });
  let botName = await botModel.find({
    status: "approved",
    name: { $regex: `${req.body.q}`, $options: "i" },
  });
  let botShort = await botModel.find({
    status: "approved",
    shortDesc: { $regex: `${req.body.q}`, $options: "i" },
  });
  let user = await userModel.findOne({ revoltId: req.session.userAccountId });
  let bot =
    botDesc.length >= 1
      ? botDesc
      : botShort.length >= 1
      ? botShort
      : botName.length >= 1
      ? botName
      : [];
  for (let i = 0; i < bot.length; i++) {
    bot[i].tags = bot[i].tags.join(", ");
  }
  if (user) {
    let userRaw = await client.users.fetch(user.revoltId);
    user.username = userRaw.username;
    user.avatar = userRaw.avatar;
    user.id = user.revoltId;
  }
  if (bot == null || bot.length == 0)
    return res.render("search.ejs", {
      error: "No bots could not be found on our list with specified term.",
      bot: bot || null,
      tag: req.query.q || null,
      user: user || null,
    });
  res.render("search.ejs", {
    user: user || null,
    bot,
    error: null,
    tag: req.params.tag,
  });
});

router.get("/tags/:tag", async (req, res) => {
  let bot = await botModel.find({
    tags: { $regex: `^${req.params.tag}$`, $options: "i" },
  });
  let user = await userModel.findOne({ revoltId: req.session.userAccountId });
  if (user) {
    let userRaw = await client.users.fetch(user.revoltId);
    user.username = userRaw.username;
    user.avatar = userRaw.avatar;
    user.id = user.revoltId;
  }
  for (let i = 0; i < bot.length; i++) {
    bot[i].tags = bot[i].tags.join(", ");
  }
  if (bot.length == 0)
    return res.render("search.ejs", {
      error: "No bots could not be found on our list with specified tag.",
      bot: bot || null,
      tag: req.params.tag || null,
      user: user || null,
    });
  res.render("search.ejs", {
    user: user || null,
    bot,
    error: null,
    tag: req.params.tag.toUpperCase(),
  });
});

router.post("/:id/vote", async (req, res) => {
  let bot = await botModel.findOne({ id: req.params.id });
  if (!bot)
    return res
      .status(404)
      .json({ message: "This bot was not found on our list." });
  let x = await voteModel.findOne({
    user: req.session.userAccountId,
    bot: req.params.id,
  });
  if (x) {
    const vote = canUserVote(x);
    if (!vote.status)
      return res
        .status(400)
        .send(`Please wait ${vote.formatted} before you can vote again.`);
    await x.remove().catch(() => null);
  }

  const D = Date.now(),
    time = 43200000;
  await voteModel.create({
    bot: req.params.id,
    user: req.session.userAccountId,
    date: D,
    time,
  });
  await botModel.findOneAndUpdate(
    { id: req.params.id },
    { $inc: { votes: 1, monthlyVotes: 1 } }
  );
  const BotRaw = await client.users.fetch(bot.id);

  const logs = client.channels.get(config.channels.votelogs);
  if (logs)
    logs
      .sendMessage(
        `<\@${req.session.userAccountId}> voted for **${BotRaw.username}**.\n<https://revoltbots.org/bots/${BotRaw._id}>`
      )
      .catch(() => null);

  return res.redirect(
    `/bots/${req.params.id}?success=true&body=You voted successfully. You can vote again after 12 hours.`
  );
});

function checkAuth(req, res, next) {
  if (req.session.userAccountId) {
    userModel.findOne(
      { revoltId: req.session.userAccountId },
      (error, userAccount) => {
        if (error) {
          res.status(500).send(error);
        } else if (userAccount) {
          next();
        } else {
          res.redirect("/login");
        }
      }
    );
  } else {
    res.redirect("/login");
  }
}

module.exports = router;

function canUserVote(x) {
  const left = x.time - (Date.now() - x.date),
    formatted = ms(left, { long: true });
  if (left <= 0 || formatted.includes("-")) return { status: true };
  return { status: false, left, formatted };
}
