
module.exports = async ()=>{
	const Fn = require('./mongo');
	const Client = await Fn.start(
		require('./setting').db,
		require('./setting').url
	);
	return { Fn,Client };
};
