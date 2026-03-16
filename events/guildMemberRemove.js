module.exports = {
    name: 'guildMemberRemove',
    execute: async (member, db) => {
        try {
            const [rows] = await db.execute(
                `SELECT message_id FROM discord_captcha_pending
                 WHERE guild_id = ? AND user_id = ?`,
                [member.guild.id, member.id]
            );

            if (rows.length) {
                const [config] = await db.execute(
                    `SELECT channel_id FROM discord_captcha_config
                     WHERE guild_id = ? AND enabled = 1`,
                    [member.guild.id]
                );

                const channel = member.guild.channels.cache.get(config[0]?.channel_id);
                if (channel) {
                    const msg = await channel.messages.fetch(rows[0].message_id).catch(() => null);
                    if (msg) await msg.delete().catch(() => {});
                }
            }

            await db.execute(
                `DELETE FROM discord_captcha_pending WHERE guild_id = ? AND user_id = ?`,
                [member.guild.id, member.id]
            );

        } catch (err) {
            console.error(err);
        }
    }
};
