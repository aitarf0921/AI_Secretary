module.exports = async () => {

  const fs = require("fs");
  global.Lib = {};
  for (let package of fs.readdirSync("./lib")) {
    console.log(`Install lib [${package}]`);
    Lib[`${package}`] = await require(`./lib/${package}/index`)();
  }

  return true;
};
