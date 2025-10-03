module.exports = async () => {

  const fs = require("fs");
  global.Lib = {};
  for (let package of fs.readdirSync("./lib")) {
    console.log(`Install lib [${package}]`);
    Lib[`${package}`] = await require(`./lib/${package}/index`)();
  }

  const knowledgeContext = `AI Chatbot 是一個免費的智慧助理工具，幫助網站提供 24/7 客戶支援，提升轉換率。無需程式碼，5 分鐘即可嵌入網站（全站 Layout 或頁尾）。主要功能包括：一鍵嵌入快速上線；自訂知識庫，提供專業回應；支援 50+ 語言，自動偵測並自然回覆；24/7 運作降低成本。服務範圍涵蓋客戶服務自動化、潛在客戶擷取、電商支援、FAQ 回應等。用戶可輸入最多 500 字知識庫內容，生成專屬 widget 程式碼（含 data-site），並自訂按鈕位置、品牌主色、面板尺寸等參數。使用前需通過 email 驗證生成程式碼，無聯絡方式`;

  // await Lib.mongoDB.Client.collection('ai_secretary')
  // .insertMany([
  //   {
  //   'email':`aitarf.crypto@gmail.com`,
  //   'siteId':'aitarf_15oJOoBsQFa3',
  //   'knowledgeContext':knowledgeContext,
  //   'creatTime':new Date(),
  //   }
  // ]).then(d=>console.log('dddddddd'));

  return true;
};
