const assert = require("node:assert/strict");
const vscode = require("vscode");
const manifest = require("../../package.json");

module.exports = async function checkContributedCommands() {
    const commands = await vscode.commands.getCommands();
    for (const { command } of manifest.contributes.commands) {
        assert.ok(commands.includes(command), command);
    }
};
