(function() {
    class InsufficientStorageError extends Error {
        constructor(msg) {
            super(msg);
        }
    }


    let services = angular.module('services', []);

    services.service('storageManager', ['$q', function($q) {
        const sync = chrome.storage.sync;
        const local = chrome.storage.local;
        const format = 'gzip';
        const itemSize = sync.QUOTA_BYTES_PER_ITEM - 6;

        let self = this;

        let get = async (keys, syncStorage = false) => {
            let data = syncStorage ? await sync.get() : await local.get();

            let base64 = '';
            let i = 0;
            while(data[i]) {
                base64 += data[i];
                i++;
            }

            if(!base64)
                return {};

            let items = JSON.parse(await decompress(base64));

            let ret = {};
            if(typeof keys === 'array') {
                for(i = 0; i < keys.length; i++) {
                    if(items[keys[i]])
                        ret[keys[i]] = items[keys[i]];
                }
            }
            else {
                ret = items;
            }

            return ret;
        };

        let set = async (data, syncStorage = false) => {
            if(typeof data === 'object') {
                let items = await get(null, syncStorage);

                for(let k in data) {
                    items[k] = data[k];
                }

                let base64 = await compress(JSON.stringify(items));
                
                let i = 0;
                let sub =  base64.substring(0);
                let d = {};

                while(sub.length > 0 ) {
                    d[i] = sub.substring(0, itemSize);
                    sub = sub.substring(itemSize);
                    i++;
                }

                if(syncStorage) {
                    if(JSON.stringify(d).length > sync.QUOTA_BYTES || Object.keys(d).length > sync.MAX_ITEMS)
                        throw new InsufficientStorageError('Too much data to fit in sync storage');
                    
                    await sync.clear();
                    await sync.set(d);
                }
                else {
                    if(JSON.stringify(d).length > local.QUOTA_BYTES)
                        throw new InsufficientStorageError('Too much data to fit in local storage');
                    
                    await local.clear();
                    await local.set(d);
                }
            }
        }


        let decompress = async (base64) => {
            let bin = atob(base64);
            let byteArray = new Uint8Array(bin.length);
            for(let i = 0; i < bin.length; i++)
                byteArray[i] = bin.charCodeAt(i);

            let cs = new DecompressionStream(format);
            let writer = cs.writable.getWriter();
            writer.write(byteArray);
            writer.close();
            let arraybuffer = await new Response(cs.readable).arrayBuffer();
            return new TextDecoder().decode(arraybuffer);
        };

        let compress = async (str) => {
            let byteArray = new TextEncoder().encode(str);
            let cs = new CompressionStream(format);
            let writer = cs.writable.getWriter();
            writer.write(byteArray);
            writer.close();
            let bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
            let blob = new Blob([bytes]);

            return await new Promise(function(resolve, reject) {
               let reader = new FileReader();

               reader.onload = function(event) {
                   resolve(event.target.result.split('base64,')[1]);
               };

               reader.readAsDataURL(blob);
            });
        };

        self.getPgpKeys = function() {
            return $q(function(resolve, reject) {
               get(['pgpKeys']).then(function({pgpKeys}) {
                   if(!pgpKeys)
                       resolve({publicKey: null, privateKey: null});
                   else
                       resolve(pgpKeys);
               }, reject);
            });
        };

        self.setPgpKeys = function({publicKey, privateKey}) {
            return $q(function(resolve, reject) {
                if(typeof publicKey !== 'string' || typeof privateKey !== 'string') {
                    reject('Invalid ' + (typeof publicKey !== 'string' ? 'Public' : 'Private') + ' Key');
                }
                else {
                    openpgp.readPrivateKey({armoredKey: privateKey}).then(function () {
                        openpgp.readKey({armoredKey: publicKey}).then(function () {
                            set({
                                pgpKeys: {
                                    publicKey: publicKey,
                                    privateKey: privateKey
                                }
                            }, true).then(function() {
                                set({
                                    pgpKeys: {
                                        publicKey: publicKey,
                                        privateKey: privateKey
                                    }
                                }).then(resolve, reject);
                            }, reject);
                        }, function() {
                            reject(new Error('Invalid Public Key'));
                        });

                    }, function () {
                        reject(new Error('Invalid Private Key'));
                    });
                }
            });
        };

        self.getPassphrase = function() {
            return $q(function(resolve, reject) {
                get(['passphrase']).then(function({passphrase}) {
                    if(!passphrase)
                        resolve(null);
                    else
                        resolve(passphrase);
                }, reject);
            });
        };

        self.setPassphrase = function(passphrase) {
            return $q(function(resolve, reject) {
                set({passphrase: passphrase}).then(resolve, reject);
            });
        };

        self.getRecipients = function(search, syncStorage = false) {
            return $q(function(resolve, reject) {
                get(['recipients'], syncStorage).then(function({recipients}) {
                    if(!recipients) {
                        resolve([]);
                    }
                    else {
                        if (typeof search !== 'string' || !search) {
                            resolve(recipients);
                        } else {
                            search = search.trim()
                                .replaceAll('$', '\\$')
                                .replaceAll('^', '\\^')
                                .replaceAll('[', '\\[')
                                .replaceAll(']', '\\]')
                                .replaceAll('{', '\\{')
                                .replaceAll('}', '\\}')
                                .replaceAll('(', '\\(')
                                .replaceAll(')', '\\)')
                                .replaceAll('.', '\\.')
                                .replaceAll('*', '\\*')
                                .replaceAll('+', '\\+')
                                .replaceAll('?', '\\?')
                                .replaceAll('/', '\\/')
                                .replaceAll('\\', '\\\\');

                            let regex = new RegExp('^' + search + '.*$', 'i');

                            resolve(recipients.filter(item => regex.test(item.id)));
                        }
                    }
                }, reject);
            });
        };

        self.addRecipient = function({id, publicKey}) {
            return $q(function(resolve, reject){
                if(typeof id !== 'string' || !id) {
                    reject(new Error('Key Name not provided'));
                }
                else if(typeof publicKey !== 'string' || publicKey.indexOf('BEGIN PGP PUBLIC KEY BLOCK') < 0) {
                    reject(new Error('Invalid Public Key'));
                }
                else {
                    id = id.trim();
                    get(['recipients']).then(function({recipients}) {
                        if(!recipients)
                            recipients = [];

                        if(recipients.find(item => item.id === id)) {
                            reject(new Error("A key with the name " + id + " already exists"));
                        }
                        else {
                            openpgp.readKey({armoredKey: publicKey}).then(function () {
                                self.getRecipients().then(function (recipients) {
                                    recipients.push({
                                        id: id,
                                        publicKey: publicKey
                                    });

                                    set({recipients: recipients}).then(resolve, reject);
                                }, reject);
                            }, function () {
                                reject(new Error('Invalid Public Key'));
                            });
                        }
                    }, reject);
                }
            });
        };

        self.removeRecipient = function(id) {
            return $q(function(resolve, reject) {
                self.getRecipients().then(function (recipients) {
                    self.getRecipients(null, true).then(function (synced) {
                        if (!recipients)
                            recipients = [];

                        if(!synced)
                            synced = [];

                        let i = recipients.findIndex(item => item.id === id);
                        let r = synced.find(item => item.id === id);

                        if (i > -1) {
                            recipients.splice(i, 1);
                            set({recipients: recipients}).then(function () {
                                if(r) {
                                    self.desyncRecipient(id).then(resolve, reject);
                                }
                                else {
                                    resolve();
                                }
                            }, reject);
                        } else {
                            resolve();
                        }
                    }, reject);
                }, reject);
            });
        };

        self.updateRecipient = function(oldId, {id, publicKey}) {
            return $q(function (resolve, reject) {
                if(typeof oldId !== 'string' || !oldId) {
                    reject(new Error('Parameter oldId must be a non empty string'));
                }
                else if(typeof id !== 'string' || !id) {
                    reject(new Error("Parameter id must be a non empty string"));
                }
                else if (typeof publicKey !== 'string' || publicKey.indexOf('BEGIN PGP PUBLIC KEY BLOCK') < 0) {
                    reject(new Error('Invalid Public Key'));
                } else {
                    openpgp.readKey({armoredKey: publicKey}).then(function () {
                        self.getRecipients().then(function (recipients) {
                            self.getRecipients(null, true).then(function (synced) {

                                if(!recipients)
                                    recipients = [];

                                if(!synced)
                                    synced = [];

                                let r = recipients.find(item => item.id === oldId);
                                let s = synced.find(item => item.id === oldId);

                                if (oldId !== id && recipients.find(item => item.id === id)) {
                                    reject(new Error('A key with the name ' + id + ' already exists'));
                                } else {
                                    if (r) {
                                        r.publicKey = publicKey;
                                        r.id = id;
                                        set({recipients: recipients}).then(function () {
                                            if(s)
                                                self.syncRecipient(angular.copy(r), oldId).then(resolve, reject);

                                            else
                                                resolve();

                                        }, reject);
                                    } else {
                                        reject(new Error('Could not find the imported key ' + oldId + ' in local storage'));
                                    }
                                }
                            }, reject);
                        }, function () {
                            reject(new Error('Invalid Public Key'));
                        });
                    }, reject);
                }
            });
        };

        self.syncRecipient = function(r, oldId = null) {
            return $q(function (resolve, reject) {
                get(['recipients'], true).then(function ({recipients}) {
                    if (!recipients)
                        recipients = [];

                    if (oldId) {
                        let rec = recipients.find(item => item.id === oldId);
                        if (rec) {
                            rec.id = r.id;
                            rec.publicKey = r.publicKey;

                            if (oldId !== r.id && recipients.find(item => item.id === r.id)) {
                                set({recipients: recipients}, true).then(resolve, reject);
                            } else {
                                reject(new Error('A recipient key with the name ' + r.id + ' already exists in sync storage'));
                            }
                        } else {
                            reject(new Error('Cannot update imported public key. ' + oldId + ' not found in sync storage'));
                        }
                    } else {
                        if (!recipients.find(item => item.id === r.id)) {
                            recipients.push(angular.copy(r));
                            set({recipients: recipients}, true).then(resolve, reject);
                        } else {
                            reject(new Error('A recipient key with the name ' + r.id + ' already exists in sync storage'));
                        }
                    }
                }, reject);
            });
        }

        self.desyncRecipient  = function(id) {
            return $q(function (resolve, reject) {
                self.getRecipients(null, true).then(function (synced) {
                    if(!synced)
                        synced = [];

                    let i = synced.findIndex(item => item.id === id);
                    if(i >= 0) {
                        synced.splice(i, 1);
                        set({recipients: synced}, true).then(resolve, reject);
                    }
                    else {
                        resolve();
                    }
                }, reject);
            });
        }

        self.clearData = function() {
            return $q(function(resolve, reject) {
                local.clear().then(function() {
                    sync.clear().then(resolve, reject);
                }, reject)
            });
        };
    }]);

    services.directive('pgpMessage', ['$q', function($q) {
        return {
            require: 'ngModel',
            link: function(scope, elm, attrs, ctrl) {
                ctrl.$asyncValidators.pgpMessage = function(modelValue, viewValue) {
                    if(ctrl.$isEmpty(modelValue)) {
                        return $q.resolve();
                    }

                    return $q(function (resolve, reject) {
                        openpgp.readMessage({armoredMessage: modelValue}).then(resolve, reject);
                    });
                }
            }
        };
    }]);

    services.directive('pgpPrivateKey', ['$q', function($q) {
        return {
            require: 'ngModel',
            link: function(scope, elm, attrs, ctrl) {
                ctrl.$asyncValidators.pgpPrivateKey = function(modelValue, viewValue) {
                    if(ctrl.$isEmpty(modelValue)) {
                        return $q.resolve();
                    }

                    let def = $q.defer();

                    openpgp.readPrivateKey({armoredKey: modelValue}).then(function() {
                        def.resolve();
                    }, function() {
                        def.reject();
                    });

                    return def.promise;
                }
            }
        }
    }]);

    services.directive('pgpPublicKey', ['$q', function($q) {
        return {
            require: 'ngModel',
            link: function(scope, elm, attrs, ctrl) {
                ctrl.$asyncValidators.pgpPublicKey = function(modelValue, viewValue) {
                    if(ctrl.$isEmpty(modelValue)) {
                        return $q.resolve();
                    }
                    else if(modelValue.indexOf('BEGIN PGP PUBLIC KEY BLOCK') < 0) {
                        return $q.reject();
                    }

                    let def = $q.defer();

                    openpgp.readKey({armoredKey: modelValue}).then(function() {
                        def.resolve();
                    }, function() {
                        def.reject();
                    });

                    return def.promise;
                }
            }
        }
    }]);

    services.directive('compareTo', function() {
        return {
            require: 'ngModel',
            scope: {
                otherModelValue: '=compareTo'
            },
            link: function(scope, elm, attrs, ctrl) {
                ctrl.$validators.compareTo = function(modelValue) {
                    return modelValue === scope.otherModelValue;
                }

                scope.$watch('otherModelValue', function() {
                    ctrl.$validate();
                });
            }
        }
    });
})();