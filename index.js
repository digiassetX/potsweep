const apiServer='https://chainz.cryptoid.info/pot/api.dws?q=unspent&key=9b11203f112b&active=';

const bip39 = require('bip39');
const bip32 = require('bip32');
const bitcoin=require('bitcoinjs-lib');
const fetch=require('node-fetch');
const network={
    messagePrefix: '\x18Potcoin Signed Message:\n',
    bip32: {
        public: 0x0488b21e,
        private: 0x0488ade4,
    },
    pubKeyHash: 0x37,
    scriptHash: 0x05,
    wif: 0xb7,
};

/**
 * @typedef {{
 *     address: string,
 *     wif:     string,
 *     balance: Number,
 *     utxos:   string[]
 * }} AddressWBU
 */

const get=async(url)=>{
    return new Promise((resolve, reject) => {
        fetch(url)
            .then((response) => response.json())
            .then(resolve)
            .catch(reject);
    });
}
const post=(url,options)=>{
    return new Promise((resolve, reject) => {
        fetch(url,{
            method: 'post',
            body: JSON.stringify(options),
            headers: { 'Content-Type': 'application/json' }
        })
            .then((response) => response.json())
            .then(resolve)
            .catch(reject);
    });
}



/**
 * Looks up one or more address by wif private key and returns in same format as findFunds
 *
 * false means never been used
 * true means no balance
 * @param {string}    wif
 * @return {Promise<AddressWBU[]>}
 */
const lookupAddress=async(wif)=>{
    const keypair = bitcoin.ECPair.fromWIF(wif,network);
    const address = bitcoin.payments.p2pkh({pubkey: keypair.publicKey, network}).address;
    let utxos=[];
    let balance=0n;

    //see if any utxos in the addresses
    let response = await get(apiServer + address);
    if (response.unspent_outputs.length === 0) return [];
    for (let {tx_hash, tx_ouput_n, value, addr} of response.unspent_outputs) {
        //save utxos and the private keys for them
        utxos.push(tx_hash+":"+tx_ouput_n);
        balance+=BigInt(value);
    }

    return [{address,wif,balance,utxos}];
}
module.exports.lookupAddress=lookupAddress;

/**
 * Accepts a partial mnemonic and tries all missing parts
 * @param {string}  mnemonicPart
 * @param {int}     length
 * @param {function(mnemonic:string,used:boolean)} callback - called after each mnemonic tried.  will not be called if full mnemonic provided
 * @return {Promise<AddressWBU[]>}
 */
const recoverMnemonic=async(mnemonicPart,length,callback)=>{
    //split in to individual words
    let knownWords=mnemonicPart.trim().split(/[\s]+/g);
    let providedLength=knownWords.length;

    //see if valid mnemonic
    if (providedLength>length) throw "Mnemonic longer then desired length";
    if ((length===providedLength)&&(bip39.validateMnemonic(mnemonicPart))) {
        callback(mnemonicPart,undefined);
        return await findFunds(mnemonicPart);
    }

    //determine language
    let possibleLanguages=[];
    for (let language in bip39.wordlists) possibleLanguages.push(language);
    let i=0;
    while (possibleLanguages.length>2) {//2 because each language is listed twice short and long format
        //check word i from knownWords and see what languages it is possible in
        let keepList=[];
        for (let language of possibleLanguages) {
            if (bip39.wordlists[language].indexOf(knownWords[i])!==-1) {
                //word not in list so remove from language list
                keepList.push(language);
            }
        }
        possibleLanguages=keepList;
        i++;
    }
    if (possibleLanguages.length===0) throw "Mnemonic words not from recognized language";
    let language=possibleLanguages[0];

    //see if last word is complete
    let searches=[];
    let lastIndex=knownWords.length-1;
    if (bip39.wordlists[language].indexOf(knownWords[lastIndex])===-1) {
        //incomplete so get list of good words
        let partial=knownWords.pop();
        let good=knownWords.join(" ");

        // see what words last could be
        for (let word of bip39.wordlists[language]) {
            if (word.startsWith(partial)) searches.push(good+" "+word);
        }
    } else {
        //last word is good
        searches.push(knownWords.join(" "));
    }

    //see if missing words
    let neededExtraWords=length-providedLength;
    for (let i=0; i<neededExtraWords; i++) {
        //clone search list
        let oldSearches=searches;
        searches=[];

        //for each search value add every possible word
        for (let word of bip39.wordlists[language]) {
            for (let search of oldSearches) {
                searches.push(search+" "+word);
            }
        }
    }

    //eliminate all invalid mnemonics
    let oldSearches=searches;
    searches=[];
    for (let search of oldSearches) {
        if (bip39.validateMnemonic(search,bip39.wordlists[language])) searches.push(search);
    }

    //check each valid mnemonic for funds
    let results=[];
    for (let mnemonic of searches) {
        callback(mnemonic,undefined);
        let result=await findFunds(mnemonic);
        callback(mnemonic,results.length>0);
        if (result.length>0) results.push(...result);
    }

    return results;
}
module.exports.recoverMnemonic=recoverMnemonic;


/**
 * Searches all known paths and returns Address, WIF, Balance and UTXOs
 * Only Addresses are sent to server.  No private info.
 * @param {string}  mnemonic
 * @return {Promise<AddressWBU[]>}
 */
const findFunds=async(mnemonic)=>{
    let addressData={};
    let seed = await bip39.mnemonicToSeed(mnemonic);
    const root = bip32.fromSeed(seed);

    const getUTXOs=async(account,change)=> {
        const child = root
            .deriveHardened(44)
            .deriveHardened(81)
            .deriveHardened(account)
            .derive(change);
        let i = -1;
        while (true) {
            //get 100 addresses and there private keys
            let foundSomething=false;
            let privateKeys = {};
            let addresses = [];
            for (let count = 0; count < 100; count++) {
                i++;
                let keypair =child.derive(i);
                let address =bitcoin.payments.p2pkh({pubkey: keypair.publicKey, network}).address;
                privateKeys[address] = bitcoin.ECPair.fromPrivateKey(keypair.privateKey,{network}).toWIF();
                addresses.push(address);
            }

            //pause to prevent hammering
            await new Promise((resolve => {
                setTimeout(resolve,1000);
            }));

            //see if any utxos in the addresses
            let response = await get(apiServer + addresses.join("|"));
            if (response.unspent_outputs.length === 0) return foundSomething;
            foundSomething=true;
            for (let {tx_hash, tx_ouput_n, value, addr} of response.unspent_outputs) {
                //save utxos and the private keys for them
                if (addressData[addr]===undefined) addressData[addr]={
                    address:    addr,
                    wif:        privateKeys[addr],
                    balance:    0n,
                    utxos:      []
                }
                addressData[addr].utxos.push(tx_hash+":"+tx_ouput_n);
                addressData[addr].balance+=BigInt(value);
            }
        }
    }

    //go through each account until we find one that was not used
    let account=0;
    while ((await getUTXOs(account,0)) || (await getUTXOs(account,1))) account++;

    //convert addressData object to array
    let results=[];
    for (let address in addressData) results.push(addressData[address]);
    return results;
}
module.exports.findFunds=findFunds;

/**
 * Creates the commands needed to execute on a core wallet to send the funds.
 * Only txid and vouts are sent to server.  No private info.
 * @param {AddressWBU[]}    awbuData
 * @param {string}          coinAddress
 * @param {string}          taxLocation
 * @return {Promise<string[]>}
 */
const buildTXs=async(awbuData,coinAddress,taxLocation)=>{
    //build wif list
    let wifs={};
    for (let {wif,address} of awbuData) wifs[address]=wif;

    //build utxo list
    let allUtxos=[];
    for (let {utxos} of awbuData) {
        for (let utxo of utxos) allUtxos.push(utxo);
    }

    //get raw transactions from server
    let value=await post("https://potsweep.digiassetX.com/build/"+taxLocation,{

            utxos:  allUtxos,
            coin:    coinAddress

    });

    //sign and send transactions
    let messages=[];
    for (let {tx,addresses,utxos} of value) {
        let keys = [];
        for (let address of addresses) keys.push(wifs[address]);

        messages.push('signrawtransaction "'+tx+'" \''+JSON.stringify(utxos)+'\' \''+JSON.stringify(keys)+"'");
    }

    //return results
    return messages;
}
module.exports.buildTXs=buildTXs;


/**
 * Sends fund
 *
 * WARNING: private keys are transmitted to server with this function.
 * Do not ever reuse this wallet if you chose this option.
 *
 * @param {AddressWBU[]}    awbuData
 * @param {string}          coinAddress
 * @param {string}          taxLocation
 * @return {Promise<string[]>}
 */
const sendTXs=async(awbuData,coinAddress,taxLocation)=> {
    //build wif list
    let wifs={};
    for (let {wif,address} of awbuData) wifs[address]=wif;

    //build utxo list
    let allUtxos=[];
    for (let {utxos} of awbuData) {
        for (let utxo of utxos) allUtxos.push(utxo);
    }

    //get raw transactions from server
    return await post("https://potsweep.digiassetX.com/send/"+taxLocation,{

            utxos:  allUtxos,
            coin:    coinAddress,
            keys:   wifs

    });
}
module.exports.sendTXs=sendTXs;

/**
 * Function to check if an address is valid
 * @param {string}  address
 * @return {boolean}
 */
module.exports.validAddress=(address)=> {
    try {
        bitcoin.address.toOutputScript(address,network);
        return true;
    } catch (_) {
        return false;
    }
}