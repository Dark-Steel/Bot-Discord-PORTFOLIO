const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logEvent = require('../utils/logEvent');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearchannel')
    .setDescription('Supprime les messages d\'un salon selon différents critères')
    .addStringOption(option =>
      option.setName('channel')
        .setDescription('Le salon à nettoyer (ID, nom ou mention)')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('days')
        .setDescription('Supprime les messages des X derniers jours')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('since')
        .setDescription('Supprime les messages depuis cette date (YYYY-MM-DD)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('until')
        .setDescription('Supprime les messages jusqu\'à cette date (YYYY-MM-DD)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('from_id')
        .setDescription('Supprime à partir de ce message (ID, inclus)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('to_id')
        .setDescription('Supprime jusqu’à ce message (ID, inclus)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    let channelInput = interaction.options.getString('channel');
    const days = interaction.options.getInteger('days');
    const since = interaction.options.getString('since');
    const until = interaction.options.getString('until');

    const fromIdRaw = interaction.options.getString('from_id');
    const toIdRaw = interaction.options.getString('to_id');

    const isSnowflake = (v) => typeof v === 'string' && /^\d{16,20}$/.test(v);
    const fromId = isSnowflake(fromIdRaw) ? fromIdRaw : null;
    const toId = isSnowflake(toIdRaw) ? toIdRaw : null;

    if (fromIdRaw && !fromId)
      return interaction.reply({ content: 'from_id invalide (doit être un ID numérique).', ephemeral: true });

    if (toIdRaw && !toId)
      return interaction.reply({ content: 'to_id invalide (doit être un ID numérique).', ephemeral: true });

    if (fromId && toId) {
      if (BigInt(fromId) > BigInt(toId)) {
        return interaction.reply({
          content: 'Intervalle invalide : from_id doit être plus ancien (<=) que to_id.',
          ephemeral: true
        });
      }
    }

    let channel;
    const mentionMatch = channelInput.match(/^<#(\d+)>$/);
    const channelId = mentionMatch ? mentionMatch[1] : channelInput;

    channel = interaction.guild.channels.cache.get(channelId);

    if (!channel) {
      channel = interaction.guild.channels.cache.find(c => c.name === channelInput && c.isTextBased());
    }

    if (!channel || !channel.isTextBased()) {
      return interaction.reply({ content: 'Salon introuvable ou non textuel.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const now = Date.now();
    const sinceDate = since ? new Date(since).getTime() : null;
    const untilDate = until ? new Date(until).getTime() : null;
    const daysMs = days ? days * 24 * 60 * 60 * 1000 : null;

    let deletedCount = 0;
    let lastId = null;

    try {
      if (toId) {
        const m = await channel.messages.fetch(toId).catch(() => null);
        if (m) {
          const created = m.createdTimestamp;
          const mId = BigInt(m.id);

          let ok = true;
          if (fromId && mId < BigInt(fromId)) ok = false;

          if (daysMs && now - created > daysMs) ok = false;
          if (sinceDate && created < sinceDate) ok = false;
          if (untilDate && created > untilDate) ok = false;

          if (ok) {
            const isTooOld = now - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000;
            if (isTooOld) await m.delete().catch(() => {});
            else await channel.bulkDelete([m], true).catch(() => m.delete().catch(() => {}));
            deletedCount += 1;
          }
        }
        lastId = toId;
      }

      while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const messages = await channel.messages.fetch(options);
        if (!messages.size) break;

        const toDelete = [];
        let reachedFrom = false;

        for (const msg of messages.values()) {
          const created = msg.createdTimestamp;

          if (fromId) {
            const msgId = BigInt(msg.id);
            if (msgId < BigInt(fromId)) {
              reachedFrom = true;
              continue;
            }
          }

          let keep = true;

          if (daysMs && now - created > daysMs) keep = false;
          if (sinceDate && created < sinceDate) keep = false;
          if (untilDate && created > untilDate) keep = false;

          if (keep) toDelete.push(msg);
        }

        if (!toDelete.length && reachedFrom) break;
        if (!toDelete.length) {
          lastId = messages.last().id;
          continue;
        }

        const bulk = toDelete.filter(m => now - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
        const old = toDelete.filter(m => now - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000);

        if (bulk.length) await channel.bulkDelete(bulk, true);
        for (const m of old) await m.delete().catch(() => {});

        deletedCount += toDelete.length;
        lastId = messages.last().id;

        if (reachedFrom) break;
      }

      let period = '';
      if (fromId && toId) period = `entre les messages ${fromId} et ${toId}`;
      else if (fromId) period = `depuis le message ${fromId}`;
      else if (toId) period = `jusqu’au message ${toId}`;
      else if (days) period = `des ${days} derniers jour(s)`;
      else if (since && until) period = `du ${since} au ${until}`;
      else if (since) period = `depuis le ${since}`;
      else if (until) period = `jusqu'au ${until}`;
      else period = 'tous les messages';

      const logMessage = `${interaction.user.tag} a supprimé ${deletedCount} message(s) dans le salon #${channel.name} (${period}).`;
      await logEvent(interaction.guild.id, logMessage, interaction.client);

      await interaction.editReply(`Suppression terminée : ${deletedCount} message(s) supprimé(s) dans ${channel}.`);
    } catch (err) {
      console.error('[CLEARCHANNEL]', err);
      await interaction.editReply('Impossible de supprimer les messages (permissions manquantes ou erreur Discord).');
    }
  }
};
