import Driver from ".";

export default <Driver> {
    name: "server-log",
    run: async (args: any) : Promise<void> => {
        console.log(args.message || args);
    }
}