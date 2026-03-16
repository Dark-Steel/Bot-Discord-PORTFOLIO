const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const { requireStaff } = require("../utils/isStaff");
const PING_ROLE_ID = "1279951256290590793";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tournoicreate")
    .setDescription("Créer un nouveau tournoi")
    .setDefaultMemberPermissions(0)

    .addStringOption(opt =>
      opt.setName("titre")
        .setDescription("Nom du jeu")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("date_tournoi")
        .setDescription("Date du tournoi (YYYY-MM-DD)")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("heure")
        .setDescription("Heure du tournoi (HH:MM)")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("type")
        .setDescription("Type de tournoi")
        .addChoices(
          { name: "Solo", value: "solo" },
          { name: "Équipe", value: "equipe" }
        )
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("description")
        .setDescription("Description affichée dans l'embed (emojis autorisés)")
        .setRequired(true)
    ),

  async execute(interaction, db) {
    if (!requireStaff(interaction)) {
      return interaction.reply({
        content: "❌ Tu n’as pas la permission d’utiliser cette commande.",
        ephemeral: true
      });
    }

    const titre = interaction.options.getString("titre");
    const dateTournoi = interaction.options.getString("date_tournoi");
    const heure = interaction.options.getString("heure");
    const type = interaction.options.getString("type");
    const description = interaction.options.getString("description");

    try {
      await db.execute(`UPDATE tournois SET is_current = 0 WHERE is_current = 1`);

      const [result] = await db.execute(
        `
        INSERT INTO tournois (titre, date_tournoi, heure, type, description, is_current)
        VALUES (?, ?, ?, ?, ?, 1)
        `,
        [titre, dateTournoi, heure, type, description]
      );

      const tournoiId = result.insertId;

      await db.execute(
        `INSERT INTO tournoi_details (tournoi_id) VALUES (?)`,
        [tournoiId]
      );

      const embed = new EmbedBuilder()
        .setTitle(`🏆 Tournoi – ${titre}`)
        .setDescription(description)
        .addFields(
          { name: "📅 Date", value: dateTournoi, inline: true },
          { name: "⏰ Heure", value: heure, inline: true },
          { name: "🎮 Type", value: type === "solo" ? "Solo" : "Équipe", inline: true }
        )
        .setFooter({ text: `ID Tournoi : ${tournoiId}` })
        .setColor("#ee5e32")
        .setTimestamp();

      const isSolo = type === "solo";

      const mainButton = new ButtonBuilder()
        .setCustomId(`${isSolo ? "tournoi_register_solo_" : "tournoi_register_team_"}${tournoiId}`)
        .setLabel(isSolo ? "✅ Inscription SOLO" : "✅ Inscription ÉQUIPE")
        .setStyle(ButtonStyle.Success);

      const subButton = new ButtonBuilder()
        .setCustomId(`tournoi_sub_${tournoiId}`)
        .setLabel("🟦 Remplaçant")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(mainButton, subButton);

      const roleMention = PING_ROLE_ID ? `<@&${PING_ROLE_ID}>` : "";

      const message = await interaction.reply({
        content: roleMention,
        allowedMentions: {
          roles: PING_ROLE_ID ? [PING_ROLE_ID] : [],
        },
        embeds: [embed],
        components: [row],
        fetchReply: true
      });

      await db.execute(
        `
        UPDATE tournois
        SET message_id = ?, channel_id = ?
        WHERE id = ?
        `,
        [message.id, message.channelId, tournoiId]
      );

    } catch (err) {
      console.error("[TOURNOI CREATE]", err);

      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: "❌ Erreur lors de la création du tournoi.",
          ephemeral: true
        });
      }
    }
  }
};
