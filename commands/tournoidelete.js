const { SlashCommandBuilder } = require("discord.js");
const { requireStaff } = require("../utils/isStaff");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tournoidelete")
    .setDescription("Supprime un tournoi par ID (STAFF uniquement)")
    .setDefaultMemberPermissions(0)
    .addIntegerOption(opt =>
      opt
        .setName("id")
        .setDescription("ID du tournoi à supprimer")
        .setRequired(true)
    ),

  async execute(interaction, db) {
    if (!requireStaff(interaction)) {
      return interaction.reply({
        content: "❌ Tu n’as pas la permission d’utiliser cette commande.",
        ephemeral: true,
      });
    }

    const id = interaction.options.getInteger("id");

    try {
      const [rows] = await db.execute(
        `
        SELECT id, is_current, channel_id, message_id
        FROM tournois
        WHERE id = ?
        LIMIT 1
        `,
        [id]
      );

      if (!rows.length) {
        return interaction.reply({
          content: `❌ Aucun tournoi trouvé avec l'ID **${id}**.`,
          ephemeral: true,
        });
      }

      const tournoi = rows[0];

      if (tournoi.channel_id && tournoi.message_id) {
        try {
          const channel = await interaction.client.channels.fetch(tournoi.channel_id);
          if (channel?.isTextBased?.()) {
            const message = await channel.messages.fetch(tournoi.message_id);
            await message.delete();
          }
        } catch (e) {
          console.warn(`[TOURNOI DELETE] Impossible de supprimer l'embed du tournoi ${id}`);
        }
      }

      await db.execute(`DELETE FROM tournoi_details WHERE tournoi_id = ?`, [id]);

      await db.execute(`DELETE FROM tournois WHERE id = ?`, [id]);

      return interaction.reply({
        content:
          `✅ Tournoi **${id}** supprimé.` +
          (tournoi.is_current ? " (C'était le tournoi courant.)" : ""),
        ephemeral: true,
      });

    } catch (err) {
      console.error("[TOURNOI DELETE]", err);
      return interaction.reply({
        content: "❌ Erreur lors de la suppression du tournoi.",
        ephemeral: true,
      });
    }
  },
};
