var fb_dstg, jazoest;
var debugLog = false;

console.log("executing background page");

chrome.browserAction.onClicked.addListener(function(tab) {
	chrome.tabs.create({'url':chrome.extension.getURL("ffbeSync.html")});
});

function getBrowser() {
  if (typeof chrome !== "undefined") {
    if (typeof browser !== "undefined") {
      return "Firefox";
    } else {
      return "Chrome";
    }
  } else {
    return "Edge";
  }
}

function forceHeader(headers, headerName, headerValue) {
    if (headers.some(h => h.name.toUpperCase() == headerName.toUpperCase())) {
        headers.filter(h => h.name.toUpperCase() == headerName.toUpperCase())[0].value = headerValue;
    } else {
        headers.push({
            name: headerName,
            value: headerValue
        });
    }
}

/*
 * FACEBOOK PART
 */

var facebookTabId;
var headerSentForError;

chrome.runtime.onMessage.addListener(function (msg, sender, data) {
	if (msg.type === 'facebookTabId') {
        facebookTabId = msg.data;
	} else if (msg.type == 'facebook_variables') {
        fb_dstg = msg.data.fb_dstg;
        jazoest = msg.data.jazoest;
        if (debugLog) {
            console.log("fb_dstg: " + fb_dstg);
            console.log("jazoest: " + jazoest);
        }
        chrome.tabs.sendMessage(facebookTabId, {type: "start_get_facebook_token"});
    }
});

chrome.webNavigation.onCompleted.addListener(function(details) {
    if (details.url && details.url.match(/dialog\/oauth/)) {
        var reg = /&state=(.*?)&scope/g;
        var match = reg.exec(details.url);
        var state = match[1];
        var origPayload = "fb_dtsg=" + fb_dstg.replace(":","%3A") + "&jazoest=" + jazoest + "&from_post=1&app_id=1238083776220999&redirect_uri=fbconnect%3A%2F%2Fsuccess&fallback_redirect_uri=&display=touch&access_token=&sdk=android-4.40.0&user_code=&encoded_state=" + state + "&read=&write=&extended=&confirm=&insecure=&insecure_new_user=&reauthorize=&original_redirect_uri=&sheet_name=initial&sdk_version=&screen_height=0&screen_width=0&seen_scopes=&return_format=return_scopes%2Cdenied_scopes%2Csigned_request%2Caccess_token&domain=&sso_device=&auth_type=rerequest&auth_nonce=&auth_token=&default_audience=friends&ref=Default&logger_id=ab638e3b-b6b3-4c04-9ede-62eb006be525&user_code=&nonce=&install_nonce=i2FoAnXpQHSCREmK&__CONFIRM__=Continue";
        $.post( "https://m.facebook.com/v3.2/dialog/oauth/confirm", origPayload)
            .done(function( data ) {
                var tokenReg = /access_token=(.*?)&/;
                var tokenMatch = tokenReg.exec(data);
                if (!tokenMatch) {
                    chrome.runtime.sendMessage({type:"error", data:"facebookToken", message: "Error page received when calling https://m.facebook.com/v3.2/dialog/oauth/confirm.\n\nHeaders sent: " + headerSentForError + "\n\nResponse received: " + data});
                    chrome.tabs.remove(facebookTabId);
                    return;
                }
                var fbToken = tokenMatch[1];

                chrome.runtime.sendMessage({type:"finished", data:"facebookToken"});
                chrome.runtime.sendMessage({type:"started", data:"facebookId"});
                chrome.tabs.remove(facebookTabId);

                var fbUrl = "https://graph.facebook.com/v3.2/me?access_token=" + fbToken + "&fields=id%2Cname%2Cfirst_name%2Clast_name%2Cinstalled%2Cemail%2Cpicture.type(small)&format=json&sdk=android";

                $.get(fbUrl)
                    .done(function(fbResponse)
                    {
                        var fbID = fbResponse["id"];
                        chrome.runtime.sendMessage({type:"finished", data:"facebookId"});
                        getUserData(fbID, fbToken);
                    });


            })
            .fail(function( jqXHR, textStatus, errorThrown ) {
                console.log(errorThrown);
                chrome.runtime.sendMessage({type:"error", data:"facebookToken", message: "Error when calling https://m.facebook.com/v3.2/dialog/oauth/confirm"});
            });
    }
}, {
    url: [{
        // Runs on example.com, example.net, but also example.foo.com
        hostContains: '.facebook.'
    }],
});

var requestFilter = {urls: ["https://m.facebook.com/v3.2/dialog/oauth/confirm"]};
var extraInfoSpec = ["requestHeaders", "blocking", "extraHeaders"];
if (getBrowser() === 'Firefox') {
    extraInfoSpec = ["requestHeaders", "blocking"];
}
var handler = function(details) {
        var headers = details.requestHeaders

        forceHeader(headers, 'Origin', 'https://m.facebook.com');
        forceHeader(headers, 'sec-fetch-site', 'cross-site');

    	if (getBrowser() === 'Firefox') {
            forceHeader(headers, 'User-Agent', 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.117 Safari/537.36');
        }

        return {requestHeaders: headers};
    };

chrome.webRequest.onBeforeSendHeaders.addListener(handler, requestFilter, extraInfoSpec);
chrome.webRequest.onSendHeaders.addListener((details) => {
    if (debugLog) {
        console.log("Header sent: " + JSON.stringify(details.requestHeaders));
    }
    headerSentForError = JSON.stringify(details.requestHeaders);
}, requestFilter, ['requestHeaders']);

/*
 * GOOGLE PART
 */

	var responseMonitor = {
        urls: ["https://accounts.google.com/*/embeddedsigninconsent*"]
    };
	var responseExtraInfoSpec = ['responseHeaders', 'extraHeaders'];
    if (getBrowser() === 'Firefox') {
		responseExtraInfoSpec = ['responseHeaders', 'blocking'];
	}
    var responseHandler = function(details) {
        var headers = details.responseHeaders;

        var found = false;
		// Find the oauth2 token
		for (var i = 0, l = headers.length; i < l; ++i) {
			if (headers[i].name == 'set-cookie')
			{
				
				var oauthReg = /oauth_token=(.*?);/;
				var oauthMatch = oauthReg.exec(headers[i].value);
				if (oauthMatch)
				{
				    found = true;
					var oauthToken = oauthMatch[1];

                    if (debugLog) {
                        console.log("Extracted oauth2 token: \n" + oauthToken);
                    }
					chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
						console.log("Sending msg to tab: " + tabs[0]);
						chrome.tabs.sendMessage(tabs[0].id, {type: "google_login_done_tab"});
					});
					
					// TODO: Figure out how to get a message from the background task to itself.
					// For now just call a function?
					getMasterToken(oauthToken);
					
					chrome.runtime.sendMessage({type: "google_login_done"});
					chrome.runtime.sendMessage({type:"google_oauth2", data:{oauthToken: oauthToken}});
					
				}
			}
		}
		if (!found) {
		    chrome.runtime.sendMessage({type:"error", data:"googleToken", message: "No Set-Cookie header: " + JSON.stringify(headers)});
        }
    };	
	
chrome.webRequest.onHeadersReceived.addListener(responseHandler, responseMonitor, responseExtraInfoSpec);

function getMasterToken(oauthToken) {

    var androidGmsTokenRequest =
        'androidId=ffbebeef&lang=en-US&google_play_services_version=19831013&sdk_version=22&device_country=us&callerSig=38918a453d07199354f8b19af05ec6562ced5788&Email=&ACCESS_TOKEN=1&droidguard_results=&service=ac2dm&add_account=1&callerPkg=com.google.android.gms&get_accountid=1&Token=' + oauthToken;

    if (debugLog) {
        console.log('Sending request to google auth as GMS with: \n ' + androidGmsTokenRequest);
    }

    $.post( "https://android.googleapis.com/auth", androidGmsTokenRequest)
        .done(function( data ) {
            if (debugLog) {
                console.log("Received data for GMS auth: \n" + data);
            }

            // Extract the server auth key
            line = data.split('\n')[0];
            var tokenReg = /Token=(.*?)$/;
            var tokenMatch = tokenReg.exec(line);
            if (!tokenMatch ||tokenMatch.length < 2) {
                chrome.runtime.sendMessage({type:"error", data:"googleToken", message: "No 'Token=' in: " + data});
            }
            var tokenCode = tokenMatch[1];

            if (debugLog) {
                console.log("Extracted GMS auth token: " + tokenCode);
            }

            chrome.runtime.sendMessage({type:"finished", data:"googleToken"});
            chrome.runtime.sendMessage({type:"started", data:"googleId"});

            getFFBEGoogleServerAuth(tokenCode);
        })
        .fail(function( jqXHR, textStatus, errorThrown ) {
            console.log(errorThrown);
        });


}

function getFFBEGoogleServerAuth(master_token) {
	var serverAuthRequest = 'androidId=&lang=en-US&google_play_services_version=19831013&sdk_version=22&request_visible_actions=&client_sig=d3aed7cbd8f386cd56edcb749d5a2684496e52b8&oauth2_include_email=0&oauth2_prompt=auto&callerSig=38918a453d07199354f8b19af05ec6562ced5788&oauth2_include_profile=1&service=oauth2%3Aserver%3Aclient_id%3A19797722756-918ovv15u2kdul81jgkgig2gfinq88no.apps.googleusercontent.com%3Aapi_scope%3Aopenid+profile&app=com.square_enix.android_googleplay.FFBEWW&check_email=1&token_request_options=CAA4AVADWhZLeTlURnVTcHJwZ19iTmxDQmF4a0ZR&callerPkg=com.google.android.gms&Token=' + master_token;

    if (debugLog) {
        console.log('Sending request to google auth: ' + serverAuthRequest);
    }


	$.post( "https://android.googleapis.com/auth", serverAuthRequest)
		.done(function( data ) {
            if (debugLog) {
                console.log("Received data for server auth: \n" + data);
            }

			// Extract the server auth key
			line = data.split('\n').find(line => line.indexOf('Auth=') > -1);
			var authReg = /Auth=(.*?)$/;
			var authMatch = authReg.exec(line);
			if (!authMatch || authMatch.length === 0) {
                chrome.runtime.sendMessage({type:"error", data:"googleId", message: "No 'Auth=' in: " + data});
                return;
            }
			var authCode = authMatch[1];

            if (debugLog) {
                console.log("Extracted auth token: " + authCode);
            }

			// Use the server auth key to get a login token

			var serverLoginRequest = '{"grant_type":"authorization_code","client_id":"19797722756-918ovv15u2kdul81jgkgig2gfinq88no.apps.googleusercontent.com","client_secret":"n5eMUGHuLV__uJ_VMd1gn_70","redirect_uri":"","code":"' + authCode + '"}';

            if (debugLog) {
                console.log("Requesting login token with auth: \n" + serverLoginRequest);
            }
			$.ajax({
			  url:"https://www.googleapis.com/oauth2/v4/token",
			  type:"POST",
			  data:serverLoginRequest,
			  contentType:"application/json; charset=utf-8",
			  dataType:"json",
			  success: function(){
			  }
			})
				.done(function( data ) {
                    if (debugLog) {
                        console.log("Received login token: \n" + JSON.stringify(data));
                    }

					googleToken = data['access_token'];

					googleIdToken = data['id_token'];

					idJson = JSON.parse(atob(googleIdToken.split('.')[1].replace(/_/g, '/').replace(/-/g, '+')));

                    if (debugLog) {
                        console.log("parsed JWT: \n" + JSON.stringify(idJson));
                    }

					googleId = idJson["sub"]

                    if (debugLog) {
                        console.log("Extracted google id: " + googleId);
                    }

					chrome.runtime.sendMessage({type:"finished", data:"googleId"});
					chrome.runtime.sendMessage({type:"started", data:"ffbeConnect"});
					getUserData(googleId, googleToken, true);

				})
				.fail(function( jqXHR, textStatus, errorThrown ) {
					console.log(errorThrown);
				});
		})
        .fail(function( jqXHR, textStatus, errorThrown ) {
            console.log(errorThrown);
            chrome.runtime.sendMessage({type:"error", data:"googleId", message: "Error getting Google ID: " + textStatus + ' ' + errorThrown});
        });
}

/*
 * FFBE PART
 */

function getUserData(accountId, authToken, isGoogle) {

    console.log("getUserDate");

    let loginUrlSymbol = 'fSG1eXI9';
    let loginKey = "rVG09Xnt\0\0\0\0\0\0\0\0";

    let userInfo1UrlSymbol = 'u7sHDCg4';
    let userInfo1Key = "rcsq2eG7\0\0\0\0\0\0\0\0";
    let userInfo1PayloadKey = 'X07iYtp5';

    let userInfo2UrlSymbol = '7KZ4Wvuw';
    let userInfo2Key = "7VNRi6Dk\0\0\0\0\0\0\0\0";
    let userInfo2PayloadKey = '2eK5Vkr8';

    let userInfo3UrlSymbol = 'lZXr14iy';
    let userInfo3Key = "0Dn4hbWC\0\0\0\0\0\0\0\0"
    let userInfo3PayloadKey = '4rjw5pnv';

    let dataBySymbol = {};
    dataBySymbol[loginUrlSymbol] = 'ffbeConnect';
    dataBySymbol[userInfo1UrlSymbol] = 'ffbeUserData';
    dataBySymbol[userInfo2UrlSymbol] = 'ffbeUserData3';
    dataBySymbol[userInfo3UrlSymbol] = 'ffbeUserData3';


    sendMessage('started', 'ffbeConnect')
        .then(() => getAuthenticationPayload(accountId, authToken, isGoogle, loginKey))
        .then(data => callActionSymbol(loginUrlSymbol, loginKey, data))
        .then(data => getLoginToken(accountId, authToken, isGoogle, data))
        .then(data => sendMessage('finished', 'ffbeConnect', data))

        .then(data => wait1s(data))
        .then(data => sendMessage('started', 'ffbeUserData', data))
        .then(data => getUserInfoRequestPayload(userInfo1Key, userInfo1PayloadKey, data))
        .then(data => callActionSymbol(userInfo1UrlSymbol, userInfo1Key, data))
        .then(data => saveResponseAs('userData', data))
        .then(data => sendMessage('finished', 'ffbeUserData', data))

        .then(data => wait1s(data))
        .then(data => sendMessage('started', 'ffbeUserData2', data))
        .then(data => getUserInfoRequestPayload(userInfo2Key, userInfo2PayloadKey, data))
        .then(data => callActionSymbol(userInfo2UrlSymbol, userInfo2Key, data))
        .then(data => saveResponseAs('userData2', data))
        .then(data => sendMessage('finished', 'ffbeUserData2', data))

        .then(data => wait1s(data))
        .then(data => sendMessage('started', 'ffbeUserData3', data))
        .then(data => getUserInfoRequestPayload(userInfo3Key, userInfo3PayloadKey, data))
        .then(data => callActionSymbol(userInfo3UrlSymbol, userInfo3Key, data))
        .then(data => saveResponseAs('userData3', data))
        .then(data => sendMessage('finished', 'ffbeUserData3', data))

        .then(data => sendMessage('userData', {userData: data.userData, userData2: data.userData2, userData3: data.userData3}))

        .catch(errorData => chrome.runtime.sendMessage({type:"error", data:dataBySymbol[errorData.actionSymbol], message: `${errorData.status} - ${errorData.error}`}));
}

function getAuthenticationPayload(accountId, authToken, isGoogle, actionKey) {
    return new Promise((resolve => {
        if (isGoogle) {
            var testPayload = "{\"LhVz6aD2\":[{\"6Nf5risL\":\"0\",\"40w6brpQ\":\"0\",\"jHstiL12\":\"0\",\"io30YcLA\":\"Nexus 6P_android6.0\",\"K1G4fBjF\":\"2\",\"e8Si6TGh\":\"\",\"1WKh6Xqe\":\"ver.2.7.0.1\",\"64anJRhx\":\"2019-02-08 11:15:15\",\"Y76dKryw\":null,\"6e4ik6kA\":\"\",\"NggnPgQC\":\"\",\"e5zgvyv7\":\"" + authToken + "\",\"GwtMEDfU\":\"" + accountId + "\"}],\"Euv8cncS\":[{\"K2jzG6bp\":\"1\"}],\"c402FmRD\":[{\"kZdGGshD\":\"2\"}],\"c1qYg84Q\":[{\"a4hXTIm0\":\"F_APP_VERSION_AND\",\"wM9AfX6I\":\"10000\"},{\"a4hXTIm0\":\"F_RSC_VERSION\",\"wM9AfX6I\":\"0\"},{\"a4hXTIm0\":\"F_MST_VERSION\",\"wM9AfX6I\":\"2047\"}]}";
        } else {
            var testPayload = "{\"LhVz6aD2\":[{\"9Tbns0eI\":null,\"9qh17ZUf\":null,\"6Nf5risL\":\"0\",\"io30YcLA\":\"Nexus 6P_android6.0\",\"K1G4fBjF\":\"2\",\"e8Si6TGh\":\"\",\"U7CPaH9B\":null,\"1WKh6Xqe\":\"ver.2.7.0.1\",\"64anJRhx\":\"2019-02-08 11:15:15\",\"Y76dKryw\":null,\"6e4ik6kA\":\"\",\"NggnPgQC\":\"\",\"X6jT6zrQ\":null,\"DOFV3qRF\":null,\"P_FB_TOKEN\":\"" + authToken + "\",\"P_FB_ID\":\"" + accountId + "\"}],\"Euv8cncS\":[{\"K2jzG6bp\":\"0\"}],\"c1qYg84Q\":[{\"a4hXTIm0\":\"F_APP_VERSION_IOS\",\"wM9AfX6I\":\"10000\"},{\"a4hXTIm0\":\"F_RSC_VERSION\",\"wM9AfX6I\":\"0\"},{\"a4hXTIm0\":\"F_MST_VERSION\",\"wM9AfX6I\":\"377\"}]}";
        }
        var encrypted = CryptoJS.AES.encrypt(testPayload, CryptoJS.enc.Utf8.parse(actionKey), { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7});
        resolve({
            payload: "{\"TEAYk6R1\":{\"ytHoz4E2\":\"75527\",\"z5hB3P01\":\"75fYdNxq\"},\"t7n6cVWf\":{\"qrVcDe48\":\"" + encrypted.ciphertext.toString(CryptoJS.enc.Base64) + "\"}}"
        });
    }));
}

function getLoginToken(accountId, authToken, isGoogle, data) {
    return new Promise(resolve => {
        if (isGoogle) {
            data.loginToken ="{\"LhVz6aD2\":[{" +
                "\"9qh17ZUf\":\"" + data.jsonResult["LhVz6aD2"][0]["9qh17ZUf"] + "\"," +
                "\"JC61TPqS\":\"" + data.jsonResult["LhVz6aD2"][0]["JC61TPqS"] + "\"," +
                "\"6Nf5risL\":\"" + data.jsonResult["LhVz6aD2"][0]["6Nf5risL"] + "\"," +
                "\"40w6brpQ\":\"0\"," +
                "\"jHstiL12\":\"0\"," +
                "\"io30YcLA\":\"Nexus 6P_android6.0\"," +
                "\"K1G4fBjF\":\"2\"," +
                "\"e8Si6TGh\":\"" + data.jsonResult["LhVz6aD2"][0]["e8Si6TGh"] + "\"," +
                "\"1WKh6Xqe\":\"ver.2.7.0.1\"," +
                "\"64anJRhx\":\"2019-02-08 11:15:15\"," +
                "\"m3Wghr1j\":\"" + data.jsonResult["LhVz6aD2"][0]["m3Wghr1j"] + "\"," +
                "\"ma6Ac53v\":\"0\"," +
                "\"D2I1Vtog\":\"0\"," +
                "\"9K0Pzcpd\":\"10000\"," +
                "\"mESKDlqL\":\"" + data.jsonResult["LhVz6aD2"][0]["mESKDlqL"] + "\"," +
                "\"iVN1HD3p\":\"" + data.jsonResult["LhVz6aD2"][0]["iVN1HD3p"] + "\"," +
                "\"Y76dKryw\":null," +
                "\"6e4ik6kA\":\"\"," +
                "\"NggnPgQC\":\"" + data.jsonResult["LhVz6aD2"][0]["NggnPgQC"] + "\"," +
                "\"GwtMEDfU\":\"" + accountId + "\"," +
                "\"e5zgvyv7\":\"" + authToken + "\"," +
                "\"9Tbns0eI\":\"" + data.jsonResult["LhVz6aD2"][0]["9Tbns0eI"] + "\"" +
                "}],\"QCcFB3h9\":[{\"qrVcDe48\":\"" + data.jsonResult["QCcFB3h9"][0]["qrVcDe48"] +
                "\"}],\"c1qYg84Q\":[{\"a4hXTIm0\":\"F_APP_VERSION_AND\",\"wM9AfX6I\":\"10000\"},{\"a4hXTIm0\":\"F_RSC_VERSION\",\"wM9AfX6I\":\"0\"},{\"a4hXTIm0\":\"F_MST_VERSION\",\"wM9AfX6I\":\"10000\"}]}";
        } else {
            data.loginToken = "{\"LhVz6aD2\":[{\"JC61TPqS\":\"" + data.jsonResult["LhVz6aD2"][0]["JC61TPqS"] + "\",\"m3Wghr1j\":\"" + data.jsonResult["LhVz6aD2"][0]["m3Wghr1j"] + "\",\"mESKDlqL\":\"" + data.jsonResult["LhVz6aD2"][0]["mESKDlqL"] + "\",\"iVN1HD3p\":\"" + data.jsonResult["LhVz6aD2"][0]["iVN1HD3p"] + "\",\"9K0Pzcpd\":\"10000\",\"X6jT6zrQ\":\"10101870574910143\",\"9Tbns0eI\":\"" + jsonResponse["LhVz6aD2"][0]["9Tbns0eI"] + "\",\"9qh17ZUf\":\"" + data.jsonResult["LhVz6aD2"][0]["9qh17ZUf"] + "\",\"6Nf5risL\":\"" + data.jsonResult["LhVz6aD2"][0]["6Nf5risL"] + "\",\"io30YcLA\":\"Nexus 6P_android6.0\",\"K1G4fBjF\":\"2\",\"e8Si6TGh\":\"" + data.jsonResult["LhVz6aD2"][0]["e8Si6TGh"] + "\",\"U7CPaH9B\":\"" + data.jsonResult["LhVz6aD2"][0]["U7CPaH9B"] + "\",\"1WKh6Xqe\":\"ver.2.7.0.1\",\"64anJRhx\":\"2019-02-08 11:15:15\",\"Y76dKryw\":null,\"6e4ik6kA\":\"\",\"NggnPgQC\":\"\",\"DOFV3qRF\":null,\"P_FB_TOKEN\":null,\"P_FB_ID\":null}],\"QCcFB3h9\":[{\"qrVcDe48\":\"" +data.jsonResult["QCcFB3h9"][0]["qrVcDe48"] + "\"}],\"Euv8cncS\":[{\"K2jzG6bp\":\"0\"}],\"c1qYg84Q\":[{\"a4hXTIm0\":\"F_APP_VERSION_IOS\",\"wM9AfX6I\":\"10000\"},{\"a4hXTIm0\":\"F_RSC_VERSION\",\"wM9AfX6I\":\"0\"},{\"a4hXTIm0\":\"F_MST_VERSION\",\"wM9AfX6I\":\"10000\"}]}";
        }
        resolve(data);
    });

}

function getUserInfoRequestPayload(actionKey, payloadKey, data) {
    return new Promise(resolve => {
        var secondEncrypted = CryptoJS.AES.encrypt(data.loginToken, CryptoJS.enc.Utf8.parse(actionKey), { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7});

        data.payload = `{"TEAYk6R1":{"ytHoz4E2":"75528","z5hB3P01":"${payloadKey}"},"t7n6cVWf":{"qrVcDe48":"${secondEncrypted.ciphertext.toString(CryptoJS.enc.Base64)}"}}`;
        resolve(data);
    });
}

function callActionSymbol(actionSymbol, actionKey, data) {
    return new Promise((resolve, reject) => {
        $.post( `https://lapis340v-gndgr.gumi.sg/lapisProd/app/php/gme/actionSymbol/${actionSymbol}.php`, data.payload)
            .done(function( response ) {
                try {
                    var encryptedPayload = response['t7n6cVWf']['qrVcDe48'];
                    var decrypted = CryptoJS.AES.decrypt({
                        ciphertext: CryptoJS.enc.Base64.parse(encryptedPayload.toString())
                    }, CryptoJS.enc.Utf8.parse(actionKey), {mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7});

                    data.jsonResult = $.parseJSON(CryptoJS.enc.Utf8.stringify(decrypted));

                    resolve(data);
                } catch (e) {
                    reject({
                        actionSymbol: actionSymbol,
                        status: e.name,
                        error: e.message
                    });
                }
            })
            .fail(function( jqXHR, textStatus, errorThrown ) {
                console.log(errorThrown);
                reject({
                    actionSymbol: actionSymbol,
                    status: textStatus,
                    error: errorThrown
                });
            });
    });
}

function saveResponseAs(name, data) {
    return new Promise(resolve => {
        data[name] = data.jsonResult;
        resolve(data);
    });
}

function sendMessage(messageType, messageData, data = {}) {
    return new Promise(resolve => {
        chrome.runtime.sendMessage({type:messageType, data:messageData});
        resolve(data);
    });
}

function wait1s(data) {
    return new Promise(resolve => setTimeout(() => resolve(data), 1000));
}