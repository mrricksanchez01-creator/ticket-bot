const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

// ================= CONFIG =================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1508124588448415814";
const STAFF_ROLE_ID = "1508034773786820660";
const GUILD_ID = "1487889233128460490";

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ================= STORAGE =================
const userToChannel = new Map();
const channelToUser = new Map();

// ================= READY + RECOVER OLD TICKETS =================
client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return console.log("Guild not found.");

  console.log("Rebuilding ticket cache...");

  const channels = await guild.channels.fetch();

  for (const [, channel] of channels) {
    if (!channel) continue;
    if (!channel.name.startsWith("ticket-")) continue;

    try {
      const messages = await channel.messages.fetch({ limit: 10 });

      const firstMsg = messages.find(
        (m) =>
          m.author.id === client.user.id &&
          m.content.includes("Hello <@")
      );

      if (!firstMsg) continue;

      const match = firstMsg.content.match(/<@(\d+)>/);
      if (!match) continue;

      const userId = match[1];

      userToChannel.set(userId, channel.id);
      channelToUser.set(channel.id, userId);

      console.log(`Recovered ticket: ${userId} -> ${channel.name}`);
    } catch {
      console.log(`Failed to scan ${channel.name}`);
    }
  }

  console.log("Ticket cache rebuilt.");
});

// ================= CREATE TICKET =================
async function createTicket(user, guild) {
  if (userToChannel.has(user.id)) {
    return client.channels.fetch(userToChannel.get(user.id));
  }

  const channel = await guild.channels.create({
    name: `ticket-${user.username}`.toLowerCase(),
    type: ChannelType.GuildText,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: STAFF_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
    ],
  });

  userToChannel.set(user.id, channel.id);
  channelToUser.set(channel.id, user.id);

  await channel.send(
`Hello <@${user.id}>!

**Ticket Type:** general

A member of the team will get back to you shortly.`
  );

  return channel;
}

// ================= REGISTER /TICKET =================
const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Create a support ticket"),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log("Slash commands registered!");
  } catch (err) {
    console.error(err);
  }
})();

// ================= SLASH COMMAND =================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ticket") {
    const channel = await createTicket(
      interaction.user,
      interaction.guild
    );

    await interaction.reply({
      content: `✅ Ticket created: ${channel}`,
      flags: 64,
    });
  }
});

// ================= MESSAGE SYSTEM =================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const userId = channelToUser.get(message.channel.id);

  // STAFF -> USER
  if (userId && message.content.startsWith(".r ")) {
    const text = message.content.slice(3).trim();
    if (!text) return;

    const user = await client.users.fetch(userId);

    await user.send(
      `📩 **${message.author.username}:** ${text}`
    );

    await message.reply("✅ Sent to user.");
    return;
  }

  // USER DM -> STAFF
  if (message.channel.isDMBased()) {
    if (!message.content.startsWith(".r ")) return;

    const text = message.content.slice(3).trim();
    if (!text) return;

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;

    const channel = await createTicket(message.author, guild);

    await channel.send(
      `💬 **${message.author.username}:** ${text}`
    );

    await message.reply("✅ Sent to support team.");
    return;
  }

  // CLOSE TICKET
  if (message.content === ".close") {
    if (!userId) {
      return message.reply(
        "❌ This is not a ticket channel."
      );
    }

    try {
      const user = await client.users.fetch(userId);

      await user.send(
`📩 **Ticket Closed**

Hello,

Your support ticket has been closed by our support team.

If you need further assistance, feel free to open a new ticket anytime.

— McRonald's Support Team`
      );

      userToChannel.delete(userId);
      channelToUser.delete(message.channel.id);

      await message.reply("✅ Closing ticket...");

      setTimeout(() => {
        message.channel.delete().catch(() => {});
      }, 2000);

    } catch (err) {
      console.log(err);
      await message.reply("❌ Failed to close ticket.");
    }
  }
});

// ================= LOGIN =================
client.login(TOKEN);
