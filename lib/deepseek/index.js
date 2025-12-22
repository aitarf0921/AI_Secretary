
module.exports = async ()=>{

	const OpenAI = require("openai");


	const deepseekKey = 'sk-090ea277ce694e508cf2ed3df4b0778d';

	const client = new OpenAI({
		baseURL: 'https://api.deepseek.com',
		apiKey: deepseekKey, // This is the default and can be omitted
	});

	return async (systemMessage, userMessage) => {
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
      max_tokens: 2000, // 限制输出长度，避免长思考过程
      temperature: 0.7, // 明确设置温度参数
      top_p: 1, // 明确设置top_p参数
      // response_format: { type: "json_object" }, // 強制輸出 JSON
    });
    return response.choices[0].message.content;
  };
};
