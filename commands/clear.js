const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logEvent = require('../utils/logEvent');

const FAMILLE_ROLE_ID = "1279900162466119753";

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription("Supprime une ou toutes les sanctions d'un membre")
    .addUserOption(option =>
      option.setName('membre')
        .setDescription('Membre concerné')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('sanction_id')
        .setDescription("ID de la sanction à supprimer (optionnel)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction, db) {
    const user = interaction.options.getUser('membre');
    const sanctionId = interaction.options.getInteger('sanction_id');

    let replied = false;

    try {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      replied = true;

      let sanctionsToDelete = [];

      if (sanctionId) {
        const [rows] = await db.execute(
          `SELECT * FROM discord_sanctions WHERE id = ? AND guild_id = ? AND user_id = ?`,
          [sanctionId, interaction.guild.id, user.id]
        );
        if (!rows.length) return interaction.editReply('Aucune sanction trouvée avec cet ID.');
        sanctionsToDelete = rows;
      } else {
        const [rows] = await db.execute(
          `SELECT * FROM discord_sanctions WHERE guild_id = ? AND user_id = ?`,
          [interaction.guild.id, user.id]
        );
        sanctionsToDelete = rows;
      }

      if (!sanctionsToDelete.length) {
        return interaction.editReply('Aucune sanction à supprimer.');
      }

      const ids = sanctionsToDelete.map(s => s.id);
      await db.execute(
        `DELETE FROM discord_sanctions WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );

      const warnCount = sanctionsToDelete.filter(s => s.type === 'WARN').length;

      if (warnCount > 0) {
        const [rows] = await db.execute(
          `SELECT warns, last_sanction FROM discord_warns WHERE guild_id = ? AND user_id = ?`,
          [interaction.guild.id, user.id]
        );

        if (rows.length) {
          let newWarns = Number(rows[0].warns || 0) - warnCount;
          if (newWarns < 0) newWarns = 0;

          const newLastSanction = newWarns === 0 ? 0 : Number(rows[0].last_sanction || 0);

          await db.execute(
            `UPDATE discord_warns SET warns = ?, last_sanction = ? WHERE guild_id = ? AND user_id = ?`,
            [newWarns, newLastSanction, interaction.guild.id, user.id]
          );
        }
      }

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      let logMessage = '';

      if (member) {
        const removedRoles = [];
        const restoredRoles = [];

        const botMember = interaction.guild.members.me;

        if (!botMember.permissions.has("ManageRoles")) {
          console.error("[CLEAR] Le bot n'a pas la permission ManageRoles (Gérer les rôles)");
        } else {
          const roles = await interaction.guild.roles.fetch().catch(() => null);

          const muetRole =
            roles?.find(r => r.name.toLowerCase() === "muet") ||
            interaction.guild.roles.cache.find(r => r.name.toLowerCase() === "muet");

          if (!muetRole) {
            console.warn("[CLEAR] Rôle 'Muet' introuvable");
          } else if (member.roles.cache.has(muetRole.id)) {
            if (muetRole.position >= botMember.roles.highest.position) {
              console.error("[CLEAR] Impossible de retirer 'Muet' : hiérarchie (rôle au-dessus du bot)");
            } else {
              await member.roles.remove(muetRole, "Clear command (unmute)").catch(err => {
                console.error("[CLEAR] Erreur retrait rôle 'Muet':", err);
              });
              removedRoles.push("Muet");

              const familleRole = await interaction.guild.roles.fetch(FAMILLE_ROLE_ID).catch(() => null);
              if (!familleRole) {
                console.warn(`[CLEAR] Rôle 'La Famille' introuvable (${FAMILLE_ROLE_ID})`);
              } else if (!member.roles.cache.has(familleRole.id)) {
                if (familleRole.position >= botMember.roles.highest.position) {
                  console.error("[CLEAR] Impossible de remettre 'La Famille' : hiérarchie (au-dessus du bot)");
                } else {
                  await member.roles.add(familleRole, "Clear command : remise La Famille après unmute").catch(err => {
                    console.error("[CLEAR] Erreur remise rôle 'La Famille':", err);
                  });
                  restoredRoles.push("La Famille");
                }
              }
            }
          }
        }

        const [tempbans] = await db.execute(
          `SELECT role_id FROM discord_tempban_roles WHERE guild_id = ? AND user_id = ?`,
          [interaction.guild.id, user.id]
        );

        if (tempbans.length) {
          const tempbanRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'tempban');
          if (tempbanRole && member.roles.cache.has(tempbanRole.id)) {
            if (tempbanRole.position >= botMember.roles.highest.position) {
              console.error("[CLEAR] Impossible de retirer 'TempBan' : hiérarchie (rôle au-dessus du bot)");
            } else {
              await member.roles.remove(tempbanRole, 'Clear command (tempban)').catch(err => {
                console.error("[CLEAR] Erreur retrait rôle 'TempBan':", err);
              });
              removedRoles.push('Tempban');
            }
          }

          for (const r of tempbans) {
            const role = await interaction.guild.roles.fetch(r.role_id).catch(() => null);
            if (role) {
              if (role.position >= botMember.roles.highest.position) {
                console.error(`[CLEAR] Impossible de remettre le rôle ${role.name} : hiérarchie (au-dessus du bot)`);
                continue;
              }
              await member.roles.add(role, 'Clear command (restauration tempban)').catch(err => {
                console.error("[CLEAR] Erreur remise rôle tempban:", err);
              });
              restoredRoles.push(role.name);
            }
          }

          await db.execute(
            `DELETE FROM discord_tempban_roles WHERE guild_id = ? AND user_id = ?`,
            [interaction.guild.id, user.id]
          );

          await db.execute(
            `UPDATE discord_sanctions SET active = 0 WHERE guild_id = ? AND user_id = ? AND type = 'TEMPBAN'`,
            [interaction.guild.id, user.id]
          ).catch(() => {});
        }

        if (removedRoles.length || restoredRoles.length) {
          logMessage += `🔄 Roles mis à jour : retiré [${removedRoles.join(', ') || 'aucun'}], remis [${restoredRoles.join(', ') || 'aucun'}]\n\n`;
        }
      }

      for (const s of sanctionsToDelete) {
        const date = s.created_at ? new Date(s.created_at).toLocaleString() : 'inconnue';

        let info = `🧹 ${interaction.user.tag} a supprimé la sanction #${s.id} (${s.type}) de ${user.tag}\n`;
        info += `• Modérateur : ${s.moderator_id} | Raison : ${s.reason}\n`;
        if (s.duration) info += `• Durée : ${s.duration}\n`;
        info += `• Date de mise : ${date}\n\n`;

        logMessage += info;
      }

      await logEvent(interaction.guild.id, logMessage, interaction.client);

      if (sanctionId) {
        await interaction.editReply(`Sanction #${sanctionId} supprimée pour ${user.tag}`);
      } else {
        await interaction.editReply(`${sanctionsToDelete.length} sanction(s) supprimée(s) pour ${user.tag}`);
      }

    } catch (err) {
      console.error('[CLEAR] Erreur:', err);

      if (!replied) {
        await interaction.reply({ content: 'Erreur lors du clear', ephemeral: true }).catch(() => {});
      } else {
        await interaction.editReply('Erreur lors du clear').catch(() => {});
      }
    }
  }
};
