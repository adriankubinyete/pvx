export default () => ({
  commands: {
    crash: {
      help: "Throws",
      run() {
        throw new Error("kaboom");
      },
    },
  },
});
