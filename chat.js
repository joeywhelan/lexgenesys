/*
 * Author: Joey Whelan
 * Desc:  Highly-modified version of the chat.js file included in the cometd vanilla demo.  Includes
 * code to integrate with AWS Lex and Genesys Chat.
 */
window.addEventListener('DOMContentLoaded', function() {
    function _id(id) {
        return document.getElementById(id);
    }

    function _empty(element) {
        while (element.hasChildNodes()) {
            element.removeChild(element.lastChild);
        }
    }

    function _show(element) {
        var display = element.getAttribute('data-display');
        // Empty string as display restores the default.
        if (display || display === '') {
            element.style.display = display;
        }
    }

    function _hide(element) {
        element.setAttribute('data-display', element.style.display);
        element.style.display = 'none';
    }
    
    function _displayText(fromUser, text) {
    	var chat = _id('chat');
    	
    	var msg = fromUser + ' ' + text;
    	chat.appendChild(document.createTextNode(msg));
        chat.appendChild(document.createElement('br'));
        chat.scrollTop = chat.scrollHeight - chat.offsetHeight;  
    }
    
    function _getTranscript(){
    	var chat = _id('chat');
    	var text;
    	if (chat.hasChildNodes()) {
    		text = '***Transcript Start***' + '\n';
    		var nodes = chat.childNodes;
    		for (var i=0; i < nodes.length; i++){
    			text += nodes[i].textContent + '\n';
    		}
    		text += '***Transcript End***';
    	}
    	return text;
    }

    function Chat(mode) {
        var _mode = mode;
    	var _self = this;
        var _firstName;
        var _lastName;
        var _cometd = new org.cometd.CometD();
        var _genesysChannel = '/service/chatV2/v2Test';
        var _genesysIndex = -1;
        var _genesysSecureKey;
        var _genesysSubscription;
        var _connected = false;

        
        // Initialize the Amazon Cognito credentials provider
        AWS.config.region = 'us-east-1'; // Region
        AWS.config.credentials = new AWS.CognitoIdentityCredentials({
            IdentityPoolId: 'yourId',
        });
        var _lexruntime = new AWS.LexRuntime();
          
        this.start = function(firstName, lastName) {
            _firstName = firstName;
            _lastName = lastName;
            if (!_firstName || !_lastName) {
                alert('Please enter a first and last name');
                return;
            }
            _mode = 'lex';
    		_lexClearSessionAttr();
    		
            _hide(_id('start'));
            _show(_id('started'));
            _id('sendButton').disabled = false;
            _id('phrase').focus();
        };

        this.leave = function() {
        	switch (_mode) {
        		case 'genesys':
        			_genesysDisconnect();
        			break;
        		case 'lex':    			
        			break;
        	}
        	_lexClearSessionAttr();
        	_id('chat').innerHTML = '';
        	_show(_id('start'));
            _hide(_id('started'));
            _id('firstName').focus();
        };
                       
        this.send = function() {
            var phrase = _id('phrase');
            var text = phrase.value.trim();
            phrase.value = '';

            if (!text || !text.length) {
                return;
            }
            
            switch (_mode) {
            	case 'genesys':
            		_genesysSend(text, false);
            		break;
            	case 'lex':
            		_lexSend(text);
            		break;
            }
        };
           
        function _genesysReceive(res) {
        	console.log('receiving genesys message: ' + JSON.stringify(res, null, 4));
    		if (res && res.data && res.data.messages) {
    			res.data.messages.forEach(function(message) {
    				if (message.index > _genesysIndex) {
    					_genesysIndex = message.index;
    					switch (message.type) {
    						case 'ParticipantJoined':
    							var nickname = _firstName + _lastName;
    							if (!_genesysSecureKey && message.from.nickname === nickname){
    								_genesysSecureKey = res.data.secureKey;
    								console.log('genesys secure key reset to: ' + _genesysSecureKey);
    								var transcript = _getTranscript();
    								if (transcript){
    									_genesysSend(transcript, true);
    								}
    							}
    							break;
    						case 'ParticipantLeft':
    							_displayText(message.from.nickname, ': has left the session.');
    							if (res.data.chatEnded === true){
    								_genesysDisconnect();
    							}
    							_id('sendButton').disabled = true;
    							break;
    						case 'Message':
    							if (message.from.type === 'Agent'){
    								_displayText(message.from.nickname + ':', message.text);
    							}
    							break;
    					}
    				}
    			});   		
    		}	
        }
        
        function _metaHandshake(message) {
        	console.log('cometd handshake msg: ' + JSON.stringify(message, null, 4));        	
        	if (message.successful === true) {
        		_genesysReqChat();
        	}
        }
        
        function _metaConnect(message) {
        	if (_cometd.isDisconnected()) {
        		return;
        	}
        	_connected = message.successful;
        }
        
        function _metaDisconnect(message) {
        	if (message.successful) {
        		_connected = false;
        	}
        }
        
        function _genesysReqChat() {
        	var reqChat = {
        			'operation' : 'requestChat',
    				'nickname' : _firstName + _lastName
    		};
        	_cometd.batch(function() { 
    			_genesysSubscription = _cometd.subscribe(_genesysChannel, _genesysReceive); 
    			_cometd.publish(_genesysChannel, reqChat);
    		});
        }
        
        function _genesysConnect() {
        	console.log('connecting to genesys');
        	if (!_connected) { 
        		_cometd.configure({
        			url: 'https://' + location.host + '/genesys/cometd',
        			logLevel: 'debug'
        		});
        		_cometd.addListener('/meta/handshake', _metaHandshake);
        		_cometd.addListener('/meta/connect', _metaConnect);
        		_cometd.addListener('/meta/disconnect', _metaDisconnect);
        		_cometd.handshake();
        	}
        	else {
        		_genesysReqChat();
        	}
        }
        
        function _genesysDisconnect() {
        	if (_genesysSecureKey){
        		console.log('disconnecting from genesys');
        		var disconnectData ={
        			"operation": "disconnect",
        			"secureKey": _genesysSecureKey
        			};
        		_cometd.batch(function() {
        			_cometd.publish(_genesysChannel, disconnectData);
        			if (_genesysSubscription) {
        				_cometd.unsubscribe(_genesysSubscription);
        				_genesysSubscription = null;
        			}	
        		});
        		//_cometd.disconnect();  //this should work, but doesn't.  Leads to a race condition or incomplete
        		//clean-up on the GMS side.  Work around is to leave the _cometd session connected until onreload
        		//event
        		_genesysSecureKey = null;
        		_genesysIndex = -1;
        	}
        }
        
        function _genesysSend(text, isTranscript) {
        	console.log('sending text to genesys');
        	
        	if (!isTranscript) {
        		var fromUser = _firstName + _lastName + ':'; 
                _displayText(fromUser, text);
        	}
        	var sendData = {
        			"operation": "sendMessage",
        			"message": text,
        			"secureKey": _genesysSecureKey
        		};
        	console.log('sending text: ' + text);
        	_cometd.publish(_genesysChannel, sendData);
        }
        
        function _lexReceive(err, data) {
        	console.log('receiving lex message')
        	if (err) {
				console.log(err, err.stack);
			}
        	
			if (data) {
				console.log('message: ' + data.message);
				var sessionAttributes = data.sessionAttributes;
				_displayText('Bot:', data.message);
				if (data.sessionAttributes && 'Agent' in data.sessionAttributes){
					_mode = 'genesys';
					_genesysConnect(_getTranscript());
				}
			}	
        }
        
        function _lexSend(text) {
        	console.log('sending text to lex');
            var fromUser = _firstName + _lastName + ':'; 
            _displayText(fromUser, text);
        
            var params = {
            		botAlias: '$LATEST',
    				botName: 'OrderFirewoodBot',
    				inputText: text,
    				userId: _firstName + _lastName,
    			};
            _lexruntime.postText(params, _lexReceive);
        }
        
        //hack for clearing data associated with a session.  Only AWS-supported way of doing that is to let it time out.
        function _lexClearSessionAttr(){
        	console.log('clearing session attributes in lex');
        	if (_firstName && _lastName) {
        		var params = {
        				botAlias: '$LATEST',
        				botName: 'OrderFirewoodBot',
        				inputText: 'null',
        				userId: _firstName + _lastName,
        				sessionAttributes: {}
        		};
        		_lexruntime.postText(params, function(err, data){
        			if (err) {
        				console.log(err, err.stack);
        			}
        		});
        	}
	
        }
        
        window.onunload = function(){
    		console.log('cleaning up: ' + _mode);
    		_lexClearSessionAttr();
    		switch (_mode) {
    			case 'genesys':	
    				_genesysDisconnect();
    				_cometd.disconnect();
    				break;
    			case 'lex':    			
    				break;
    		}
        };
    }
    
    var chat = new Chat('lex');

    // Setup UI
    _show(_id('start'));
    _hide(_id('started'));
    _id('startButton').onclick = function() {
        chat.start(_id('firstName').value, _id('lastName').value);
    };
    _id('sendButton').onclick = chat.send;
    _id('leaveButton').onclick = chat.leave;
    _id('firstName').autocomplete = 'off';
    _id('firstName').focus();
    _id('lastName').autocomplete = 'off';
    _id('phrase').autocomplete = 'off';
    _id('phrase').onkeyup = function(e) {
        if (e.keyCode === 13) {
            chat.send();
        }
    };
});

