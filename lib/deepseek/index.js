
module.exports = async ()=>{

	const OpenAI = require("openai");


	const deepseekKey = 'sk-5308e14236f242bdb889baa15fbd7338';

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
      // response_format: { type: "json_object" }, // 強制輸出 JSON
    });
    return response.choices[0].message.content;
  };
};
