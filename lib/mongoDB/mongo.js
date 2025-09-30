
module.exports = {
	async start(db,url) {

		console.log(`mongodb(${db}) start connecting...`);

		const { MongoClient, ServerApiVersion } = require('mongodb');
		const path = require('path');

		const client = new MongoClient(url,{
			tlsCertificateKeyFile: path.resolve(__dirname, './cert.pem'),
			serverApi: ServerApiVersion.v1,
		});

		return await client.connect()
			.then(data=>{
				console.log('mongodb connect done');
				return data.db(db);
			})
			.catch(err=>{
				console.log('mongodb connect fail',err);
				return process.exit(1);
			});
	},
	async agg({ db,coll='',query=[] }) {
		return await db.collection(`${coll}`)
		.aggregate(query,{ 'allowDiskUse': true })
		.toArray()
		.then(d=>d);
	},
};
