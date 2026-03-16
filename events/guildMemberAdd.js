const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const crypto = require('crypto');
const logEvent = require('../utils/logEvent');

const NON_VERIF_ROLE_ID = "1390384515909685328";

module.exports = {
  name: 'guildMemberAdd',
  execute: async (member, db, client) => {
    try {
      console.log(`[MEMBER JOIN] ${member.user.tag} (${member.id})`);

      await db.execute(
        `INSERT INTO discord_members
         (guild_id, user_id, verified, joined_at, left_at, pseudo, is_bot, is_present)
         VALUES (?, ?, 0, NOW(), NULL, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
            is_present = 1,
            left_at = NULL,
            pseudo = VALUES(pseudo),
            is_bot = VALUES(is_bot)`,
        [
          member.guild.id,
          member.id,
          member.nickname || member.user.username,
          member.user.bot ? 1 : 0
        ]
      );

      await db.execute(
        `DELETE FROM discord_captcha_pending WHERE guild_id = ? AND user_id = ?`,
        [member.guild.id, member.id]
      );

      const [rows] = await db.execute(
        `SELECT * FROM discord_captcha_config WHERE guild_id = ? AND enabled = 1`,
        [member.guild.id]
      );
      if (!rows.length) return;

      const config = rows[0];

      const nonVerifRole = await member.guild.roles.fetch(NON_VERIF_ROLE_ID).catch(() => null);

      if (!nonVerifRole) {
        console.warn(`[CAPTCHA] Rôle "Non vérifié" introuvable (${NON_VERIF_ROLE_ID})`);
      } else {
        const botMember = member.guild.members.me;

        if (!botMember.permissions.has("ManageRoles")) {
          console.error("[CAPTCHA] Permission Gérer les rôles manquante (ManageRoles)");
        } else if (nonVerifRole.position >= botMember.roles.highest.position) {
          console.error("[CAPTCHA] Impossible d'attribuer le rôle Non vérifié : hiérarchie des rôles");
        } else {
          await member.roles.add(nonVerifRole, "Captcha : rôle Non vérifié à l'arrivée").catch(err => {
            console.error("[CAPTCHA] Erreur ajout rôle Non vérifié:", err);
          });
        }
      }

      const channel = member.guild.channels.cache.get(config.channel_id);
      if (!channel) {
        console.warn(`[CAPTCHA] Salon captcha introuvable (${config.channel_id})`);
        return;
      }

      const captchaToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + config.timeout_minutes * 60 * 1000);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`captcha_${captchaToken}`)
          .setLabel('Je suis humain ✅')
          .setStyle(ButtonStyle.Success)
      );

      const message = await channel.send({
        content: `${member}, clique sur le bouton pour valider le captcha.`,
        components: [row]
      }).catch(err => {
        console.error("[CAPTCHA] Impossible d'envoyer le message captcha:", err);
        return null;
      });

      if (!message) return;

      await db.execute(
        `INSERT INTO discord_captcha_pending
         (guild_id, user_id, expires_at, captcha_token, message_id)
         VALUES (?, ?, ?, ?, ?)`,
        [member.guild.id, member.id, expiresAt, captchaToken, message.id]
      );

      setTimeout(async () => {
        try {
          const [pending] = await db.execute(
            `SELECT * FROM discord_captcha_pending WHERE guild_id = ? AND user_id = ?`,
            [member.guild.id, member.id]
          );

          if (!pending.length) return;
          if (pending[0].captcha_token !== captchaToken) return;

          const [cfg] = await db.execute(
            `SELECT kick_message FROM discord_captcha_config WHERE guild_id = ? AND enabled = 1`,
            [member.guild.id]
          );

          const kickMessage = cfg.length && cfg[0].kick_message
            ? cfg[0].kick_message
            : 'Captcha non validé à temps.';

          await member.send(kickMessage).catch(() => {});
          await member.kick('Captcha non validé');

          console.log(`[CAPTCHA] ${member.user.tag} kick (timeout)`);

          await logEvent(
            member.guild.id,
            `❌ ${member.user.tag} a été kick pour ne pas avoir validé le captcha.`,
            client
          );

          await db.execute(
            `DELETE FROM discord_captcha_pending WHERE guild_id = ? AND user_id = ?`,
            [member.guild.id, member.id]
          );

          await db.execute(
            `UPDATE discord_members
             SET is_present = 0,
                 left_at = IF(left_at IS NULL, NOW(), left_at)
             WHERE guild_id = ? AND user_id = ?`,
            [member.guild.id, member.id]
          );
        } catch (err) {
          console.error('[CAPTCHA TIMEOUT]', err);
        }
      }, config.timeout_minutes * 60 * 1000);

    } catch (err) {
      console.error('[guildMemberAdd]', err);
    }
  }
};
