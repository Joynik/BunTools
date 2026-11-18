suite("Bun Tools", () => {
    test("passes the complete editor integration suite", async () => {
        await require("../../dist/host-test.cjs").run();
    });
});
