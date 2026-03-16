const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./database/db');

const syncMembers = require('./utils/syncMembers');
const checkMutes = require('./utils/checkMutes');
const checkTempBans = require('./utils/checkTempBans');
const checkWarns = require('./utils/checkWarns');
const tournoiRegisterHandler = require("./handlers/tournoiRegisterHandler");
const tournoiConfirmHandler = require("./handlers/tournoiConfirmHandler");
const eventButtonHandler = require("./handlers/eventButtonHandler");

const NON_VERIF_ROLE_ID = "1390384515909685328";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: ['MESSAGE', 'CHANNEL', 'REACTION']
});

require('./events/logs.register')(client);

client.commands = new Collection();  
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  try {
    const command = require(path.join(commandsPath, file));

    if (!command?.data?.name || typeof command.execute !== "function") {
      console.warn(`[CMD LOAD] ❌ Ignorée: ${file} (export invalide : data.name ou execute manquant)`);
      continue;
    }

    client.commands.set(command.data.name, command);
  } catch (err) {
    console.error(`[CMD LOAD] ❌ Crash sur ${file}`, err);
  }
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs
  .readdirSync(eventsPath)
  .filter(f => f.endsWith('.js') && f !== 'logs.register.js');




for (const file of eventFiles) {
  try {
    const event = require(path.join(eventsPath, file));

    if (!event?.name || typeof event.execute !== "function") {
      console.warn(`[EVENT LOAD] ❌ Ignoré: ${file} (export invalide : name/execute manquant)`);
      continue;
    }

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, db, client));
    } else {
      client.on(event.name, (...args) => {
        Promise.resolve(event.execute(...args, db, client)).catch(err => {
          console.error(`[EVENT] Erreur dans ${event.name} (${file}):`, err);
        });
      });
    }

  } catch (err) {
    console.error(`[EVENT LOAD] ❌ Crash sur ${file}`, err);
  }
}

client.on('interactionCreate', async interaction => {

  try {
    await tournoiConfirmHandler(interaction);
  } catch (e) {
    console.error("[TOURNOI CONFIRM HANDLER]", e);
  }

  if (
    interaction.isButton() &&
    (interaction.customId.startsWith("event_join:") || interaction.customId.startsWith("event_leave:"))
  ) {
    const handled = await eventButtonHandler(interaction, db, client);
    if (handled) return;
  }

  if (
    (interaction.isButton() &&
      (
        interaction.customId.startsWith("tournoi_register_solo_") ||
        interaction.customId.startsWith("tournoi_reg_yes_") ||
        interaction.customId.startsWith("tournoi_reg_change_") ||
        interaction.customId.startsWith("tournoi_sub_")
      )
    ) ||
    (interaction.isModalSubmit() && interaction.customId.startsWith("tournoi_reg_modal_"))
  ) {
    return tournoiRegisterHandler(interaction, db);
  }

  if (interaction.isButton()) {

    if (interaction.customId.startsWith("r6apply_")) {
      const r6ApplyHandler = require("./handlers/r6ApplyHandler");
      await r6ApplyHandler(interaction, db);
      return;
    }

    if (interaction.customId.startsWith("ow2apply_")) {
      const ow2ApplyHandler = require("./handlers/ow2ApplyHandler");
      await ow2ApplyHandler(interaction, db);
      return;
    }

    if (interaction.customId.startsWith("valoapply_")) {
      const valoApplyHandler = require("./handlers/valoApplyHandler");
      await valoApplyHandler(interaction, db);
      return;
    }

    if (interaction.customId === "link_get_code") {
      const linkButtonHandler = require("./handlers/linkButtonHandler");
      return linkButtonHandler(interaction, db);
    }

    if (interaction.customId.startsWith('captcha_')) {
      const captchaToken = interaction.customId.replace('captcha_', '');

      try {
        const [pendingRows] = await db.execute(
          `SELECT * FROM discord_captcha_pending WHERE captcha_token = ?`,
          [captchaToken]
        );

        if (!pendingRows.length) {
          return interaction.reply({ content: 'Ce captcha a expiré.', ephemeral: true }).catch(() => {});
        }

        const pending = pendingRows[0];

        if (interaction.user.id !== pending.user_id) {
          return interaction.reply({ content: 'Ce captcha ne te concerne pas.', ephemeral: true }).catch(() => {});
        }

        const [configRows] = await db.execute(
          `SELECT * FROM discord_captcha_config WHERE guild_id = ? AND enabled = 1`,
          [pending.guild_id]
        );
        if (!configRows.length) {
          return interaction.reply({ content: 'Captcha désactivé sur ce serveur.', ephemeral: true }).catch(() => {});
        }

        const roleId = configRows[0].role_id;
        const member = await interaction.guild.members.fetch(pending.user_id).catch(() => null);
        if (!member) {
          return interaction.reply({ content: "Impossible de récupérer le membre.", ephemeral: true }).catch(() => {});
        }

        if (roleId) {
          const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
          if (role) {
            await member.roles.add(role, "Captcha validé").catch(err => {
              console.error("[CAPTCHA] Erreur ajout rôle vérifié:", err);
            });
          }
        }

        const nonVerifRole = await interaction.guild.roles.fetch(NON_VERIF_ROLE_ID).catch(() => null);
        if (nonVerifRole && member.roles.cache.has(nonVerifRole.id)) {
          await member.roles.remove(nonVerifRole, "Captcha validé : retrait Non vérifié").catch(err => {
            console.error("[CAPTCHA] Erreur retrait rôle Non vérifié:", err);
          });
        }

        await db.execute(
          `DELETE FROM discord_captcha_pending WHERE captcha_token = ?`,
          [captchaToken]
        );

        await db.execute(
          `UPDATE discord_members SET verified = 1 WHERE guild_id = ? AND user_id = ?`,
          [pending.guild_id, pending.user_id]
        );

        await interaction.update({
          content: `✅ ${member.user.tag} a validé le captcha. Bienvenue !`,
          components: []
        }).catch(async () => {
          await interaction.reply({ content: 'Captcha validé. Bienvenue !', ephemeral: true }).catch(() => {});
        });

        await interaction.message.delete().catch(() => {});

        console.log(`[CAPTCHA] ${member.user.tag} validé`);
      } catch (err) {
        console.error('[CAPTCHA BUTTON]', err);
        if (!interaction.deferred && !interaction.replied) {
          await interaction.reply({ content: "Erreur captcha.", ephemeral: true }).catch(() => {});
        }
      }

      return;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('ticket_remove_')) {
      try {
        const ticketRemoveHandler = require('./events/ticketRemoveSelect');
        await ticketRemoveHandler.execute(interaction, db, client);
      } catch (err) {
        console.error('[TICKET REMOVE SELECT]', err);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    return interaction.reply({ content: "Commande non chargée côté bot.", ephemeral: true }).catch(() => {});
  }

  try {
    await command.execute(interaction, db);
  } catch (error) {
    console.error(`[CMD] Erreur commande /${interaction.commandName} (${interaction.commandId})`, error);

    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: "Erreur commande.", ephemeral: true }).catch(() => {});
    }
  }
});

client.once('ready', async () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  const commands = [];
  for (const command of client.commands.values()) {
    commands.push(command.data.toJSON());
  }

  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('Commandes déployées');
  } catch (error) {
    console.error('Erreur déploiement commandes:', error);
  }

  await syncMembers(client, db);

  setInterval(() => syncMembers(client, db).catch(console.error), 6 * 60 * 60 * 1000);
  setInterval(() => checkMutes(client, db).catch(console.error), 60 * 1000);
  setInterval(() => checkTempBans(client, db).catch(console.error), 60 * 1000);
  setInterval(() => checkWarns(client, db).catch(console.error), 24 * 60 * 60 * 1000);

  const checkBirthdays = require("./utils/checkBirthdays");

  let lastRunKey = null;

  setInterval(async () => {
    const { getNowPartsTZ } = require("./utils/birthdayUtils");
    const p = getNowPartsTZ();
    const key = `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;

    if (p.hour === 0 && p.minute === 1 && lastRunKey !== key) {
      lastRunKey = key;
      await checkBirthdays(client, db).catch(console.error);
    }
  }, 60 * 1000);
});

client.login(process.env.DISCORD_TOKEN);
