const { SlashCommandBuilder } = require("discord.js");
const { requireStaff } = require("../utils/isStaff");
const { buildHelpPages } = require("../utils/helpEmbeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Affiche le guide des commandes du bot"),

  async execute(interaction) {
    const isStaff = requireStaff(interaction);

    const pages = buildHelpPages({ isStaff });

    await interaction.reply({
      embeds: [pages[0]],
      ephemeral: true
    });
  }
};
