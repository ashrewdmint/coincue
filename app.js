var sys = require('sys');
var bigint = require('bigint');
var events = require('events').EventEmitter;

var bitcoin = require('bitcoin-p2p');
var storage = new bitcoin.Storage('mongodb://localhost/bitcoin');
var node    = new bitcoin.Node();
var chain = node.getBlockChain();

global.Util = bitcoin.Util;

// Adds a list of outpoint addresses and values to a transaction
// Also adds transaction fee value (if any) and ouput values
// that have been converted back to normal numbers

Util.bigIntToBTC = function(bigInt) {
  return bigInt.div(Math.pow(10, 8)).toNumber();
};

function parseTxs(txs, callback) {
  if (txs.hash) txs = [txs];
  var referenceTxHashes = [];
  
  // Figure out all the transactions we need to find from the DB
  txs.forEach(function(tx){
    tx.ins.forEach(function(txInput){
      referenceTxHashes.push(txInput.outpoint.hash);
    });
  });
  
  // Find this transactions' inputs' outpoints
  // i.e., the previous transactions which the inputs reference
  storage.Transaction.find({hash: {"$in": referenceTxHashes}}, function(error, records){
    if (error) callback({error: error});
    
    // Index the referenced transactions by their hash
    var referenceTxs = [];
    records.forEach(function(record){
      referenceTxs[record.hash.toString('base64')] = record
    });
    
    // Go through each original transaction
    // (the transactions we're actually interested in)
    txs.forEach(function(tx, index){
      
      // Tack on some new properties
      tx.totalIn = bigint(0);
      tx.totalOut = bigint(0);
      tx.inputs = [];
      tx.outputs = [];
      tx.parsed = true;
      
      // Iterate through transaction inputs
      tx.ins.forEach(function(txInput){
        // Find this transaction's "source", or referenced transaction
        var hash = txInput.outpoint.hash.toString('base64');
        var sourceTx = referenceTxs[hash];
        
        // Find the output the input is referencing
        var sourceOut = sourceTx.outs[txInput.outpoint.index];
        
        var inputObj = {
          transactionHash: hash,
          index: txInput.outpoint.index,
          address: sourceOut.script.toString('base64'),
          value: Util.valueToBigInt(sourceOut.value)
        };
        
        // Readable value for those of us who don't understand BigInts
        inputObj.btc = Util.bigIntToBTC(inputObj.value);
        
        tx.inputs.push(inputObj);
        tx.totalIn.add(inputObj.value); // Add to total value in
      });
      
      // Iterate through transaction outputs
      tx.outs.forEach(function(txOutput, index){
        // Add to total value out
        
        var outputObj = {
          address: txOutput,
          index: index,
          value: Util.valueToBigInt(txOutput.value)
        };
        
        outputObj.btc = Util.bigIntToBTC(outputObj.value);
        
        tx.totalOut.add(outputObj.value);
        tx.outputs.push(outputObj);
      });
      
      // Determine transaction fee: output value - input value
      if (!tx.isCoinBase()) {
        tx.fee = tx.totalIn.sub(tx.totalOut);
        tx.btcfee = Util.bigIntToBTC(tx.fee);
      }
      
      // Update txs array
      txs[index] = tx;
    });
    
  });
  
  callback({txs: txs});
  
}

chain.on('blockAdd', function(data){
  parseTxs(data.txs, function(data){
    if (data.error) {
      console.log("Error");
      console.log(data.error);
      return;
    }
    
    data.txs.forEach(function(tx){
      console.log(tx.hash.toString('base64'));
      if (! tx.parsed) {
        
        var value = Util.valueToBigInt(tx.outs[0].value);
        var btc = Util.bigIntToBTC(value);
        console.log("BTC: " + btc);
        return;
      }
      
      console.log(tx.inputs);
      console.log(tx.ouputs);
      console.log(tx.btcfee);
      console.log();
    });
    
  });
});

node.start();

