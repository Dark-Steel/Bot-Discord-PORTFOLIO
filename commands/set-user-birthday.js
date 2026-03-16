const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { requireStaff } = require("../utils/isStaff");
const { parseBirthdayInput, formatDateFR, makeEmbed, applyBirthdayNow } = require("../utils/birthdayUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("set-user-birthday")
    .setDescription("STAFF: Définit l'anniversaire d'un membre")
    .addUserOption(o => o.setName("membre").setDescription("Membre").setRequired(true))
    .addStringOption(o => o.setName("date").setDescription("YYYY-MM-DD ou MM-DD").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, db) {
    if (!requireStaff(interaction)) {
      return interaction.reply({ embeds: [makeEmbed("⛔ Accès refusé", "Commande réservée au staff.")] });
    }

    const user = interaction.options.getUser("membre");
    const input = interaction.options.getString("date");
    const parsed = parseBirthdayInput(input);
    if (!parsed.ok) return interaction.reply({ embeds: [makeEmbed("❌ Anniversaire", parsed.error)] });

    const { year, month, day } = parsed;

    await db.execute(
      `INSERT INTO discord_birthdays (guild_id, user_id, month, day, year)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE month=VALUES(month), day=VALUES(day), year=VALUES(year)`,
      [interaction.guild.id, user.id, month, day, year]
    );

    await interaction.reply({
      embeds: [makeEmbed("✅ Anniversaire défini", `Anniversaire de ${user} : **${formatDateFR(month, day, year)}**`)]
    });

    await applyBirthdayNow(interaction.guild, user.id, db, true).catch(() => {});
  },
};
