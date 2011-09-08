var sys = require('sys');
var bigint = require('bigint');
var events = require('events').EventEmitter;

var bitcoin = require('bitcoin-p2p');
var storage = new bitcoin.Storage('mongodb://localhost/bitcoin');
var node    = new bitcoin.Node();
var chain = node.getBlockChain();

global.Util = bitcoin.Util;

function getOutpoints(txs, callback) {
  // If we got only one tx, wrap it so we can use the same code afterwards
  if (txs.hash) txs = [txs];
  
  // Go through each transaction "ins" and
  // make a list of their <Buffer> hashes
  var txList = []
  txs.forEach(function(tx){
    tx.ins.forEach(function(txin){
      txList.push(txin.outpoint.hash)
    });
  });
  
  // Find all transactions in the database that match this transaction's "ins"
  storage.Transaction.find({hash: {"$in": txList}}, function(err, result) {
    if (err) return callback(err);
    
    console.log(result);
    
    // Create a list of the transactions we got from the database
    // Use their hash as a key so we can find them later easily
    var txIndex = {};
    result.forEach(function(tx){
      txIndex[tx.hash.toString('base64')] = tx;
    });
    
    // Now let's go back through our original list of transactions
    txs.forEach(function(tx, i){
      
      // Add some in and out values
      tx.totalIn = bigint(0);
      tx.totalOut = bigint(0);
      
      // Go through all the "ins"
      tx.ins.forEach(function(txin, j){
        
        // Now find grab the DB result for this transaction
        var op = txin.outpoint
        var srctx = txIndex[op.hash.toString('base64')];
        if (srctx) {
          // Okay, so it looks srctx.outs[txin.outpoint.index].value is the transaction value
          // Confused by this part
          txin.source = srctx.outs[op.index];
          tx.totalIn = tx.totalIn.add(Util.valueToBigInt(txin.source.value));
        }
      });
      
      // Now figure out the transaction output value
      tx.outs.forEach(function(txout){
        tx.totalOut = tx.totalOut.add(Util.valueToBigInt(txout.value));
      });
      
      // And figure out the transaction fee by subtracting
      // totalIn - totalOut
      if (!tx.isCoinBase()) tx.fee = tx.totalIn.sub(tx.totalOut);
    });
    callback(null);
  });
}


chain.on('txAdd', function(data){
  var tx = data.tx;
  
  console.log("");
  
  tx.ins.forEach(function(txin, index){
    var lasttx = txin.outpoint.hash.toString('base64');
    
    // No idea how to take a uint32 and turn it into a "regular" number
    //var lasttxpos = bigint(txin.outpoint.index, 10).toNumber();
    
    var assocOut = tx.outs[index];
    var value = Util.valueToBigInt(assocOut.value);
    var btc = value.div(Math.pow(10, 8)).toNumber();
    
    var lasttxvalue = bigint.fromBuffer(txin.outpoint).toNumber();
    
    if (lasttxvalue == 0) {
      console.log("Mining reward");
    } else {
      console.log("Coins from: " + lasttx);
    }
    
    console.log("Sent to: " + assocOut.script.toString('base64'));
    console.log("Value: " + btc + " BTC");
    
  });
  
});

chain.on('blockAdd', function(data){
  return;
  var txs = data["txs"];
  
  getOutpoints(txs, function(){
    // txs.forEach(function (txin, i){
    //   
    //   console.log(txin.hash);
    //   console.log(txin.totalIn);
    //   console.log(txin.totalOut);
    //   console.log(" ");
    //   
    // });
  });
  
  //console.log(data["txs"]);
  //console.log(data["block"]);
});

node.start();

