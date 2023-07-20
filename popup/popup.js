(function() {
    let popup = angular.module('popup', ['ngSanitize', 'ngBootstrap5', 'services']);

    popup.service('pageControl', function() {
        let show = {
            noPgpKeys: false,
            encryptDecrypt: true,
            error: false
        };

        let error = {
            message: null
        };

        this.isPageShown = function(key) {
            let ret = false;
            if(typeof show[key] === 'boolean')
                ret = show[key];

            return ret;
        };

        this.showPage = function(key) {
            if(typeof show[key] === 'boolean') {
                for(let k in show) {
                    if (show[k])
                        error.lastPage = k;

                    show[k] = false;
                }

                show[key] = true;
            }
        };

        this.showErrorPage = function(msg) {
            error = msg;
            this.showPage('error');
        };

        this.getError = function() {
            return error;
        };

        this.openOptions = function(e) {
            if(e)
                e.preventDefault();


            chrome.runtime.openOptionsPage();
        }
    });

    popup.controller('MainController', ['$scope', 'pageControl', 'storageManager', function($scope, pages, storage) {
        $scope.pages = pages;

        storage.getPgpKeys().then(function(pgpKeys) {
            $scope.keys = pgpKeys;

            if(!pgpKeys.publicKey || !pgpKeys.privateKey)
                pages.showPage('noPgpKeys');
        }, function(ex) { console.error(ex) });
    }]);

    popup.controller('EncryptController', ['$scope', '$q', 'pageControl', 'storageManager', function($scope, $q, pages, storage) {
        $scope.display = 'encrypt';

        $scope.recipientsPage = {
            search: function(term) {
                storage.getRecipients(term).then(function(recipients) {
                    $scope.recipientsPage.recipients = recipients;

                    let page = $scope.recipientsPage.page;
                    page.page = 1;
                    page.total = recipients.length;
                    page.items = recipients.slice(0, page.pageSize);
                }, function(ex) {
                    pages.showErrorPage('Could not get a list of recipients');
                });
            },
            page: {
                page: 1,
                pageSize: 7,
                total: 0,
                items: [],
                changePage: function(pg) {
                    let page = $scope.recipientsPage.page;
                    let recipients = $scope.recipientsPage.recipients;
                    page.page = pg;
                    page.items = recipients.slice((pg - 1) * page.pageSize, ((pg - 1) * page.pageSize) + page.pageSize);
                }
            }
        };

        $scope.encryptPage = {
            model: {text: null},
            encrypted: null,
            clear: function(form) {
                $scope.encryptPage.model.text = null;
                $scope.encryptPage.encrypted = null;

                form.$setUntouched();
                form.$setPristine();
            },
            encrypt: function (form) {
                form.$setSubmitted();

                if (form.$valid) {
                    $q(function (resolve, reject) {
                        storage.getPgpKeys().then(function ({publicKey}) {
                            openpgp.readKey({armoredKey: publicKey}).then(function(key) {
                                openpgp.createMessage({text: $scope.encryptPage.model.text}).then(function (message) {
                                    openpgp.encrypt({
                                        message: message,
                                        encryptionKeys: key
                                    }).then(resolve, reject);
                                }, reject);
                            }, reject);
                        }, reject);
                    }).then(function (encrypted) {
                        $scope.encryptPage.encrypted = encrypted;
                    }, function (ex) {
                        console.error(ex);
                        pages.showErrorPage(ex.message);
                    });
                }
            },
            selectRecipient: function(form) {
                form.$setSubmitted();

                if(form.$valid) {
                    $scope.recipientsPage.search();
                    $scope.recipientsPage.term = null;
                    $scope.display = 'recipients';
                    $scope.recipientsPage.deferred = $q.defer();
                    $scope.recipientsPage.deferred.promise.then(function(recipient) {
                        if(!recipient) {
                            $scope.display = 'encrypt';
                        }
                        else {
                            $q(function (resolve, reject) {
                                openpgp.readKey({armoredKey: recipient.publicKey}).then(function (key) {
                                    openpgp.createMessage({text: $scope.encryptPage.model.text}).then(function (message) {
                                        openpgp.encrypt({
                                            message: message,
                                            encryptionKeys: key,
                                            date: key.getCreationTime()
                                        }).then(resolve, reject);
                                    }, reject);
                                }, reject);
                            }).then(function (encrypted) {
                                $scope.encryptPage.encrypted = encrypted;
                                $scope.display = 'encrypt';
                            }, function (ex) {
                                $scope.display = 'encrypt';
                                pages.showErrorPage(ex.message);
                            });
                        }
                    });
                }
            }
        };

    }]);

    popup.controller('DecryptController', ['$scope', '$q', 'pageControl', 'storageManager', function($scope, $q, pages, storage) {
        $scope.display = 'decrypt';
        $scope.passphrase = {
            deferred: null,
            model: {
                passphrase: null,
                remember: false
            }
        };

        $scope.decrypt = {
            decrypted: null,
            model: {
                msg: null
            },
            clear: function(form) {
              $scope.decrypt.decrypted = null;
              $scope.decrypt.model.msg = null;
              form.$setPristine();
              form.$setUntouched();
            },
            decrypt: function(form, e) {
                let decrypt = function(privateKey, msg) {
                    return $q(function(resolve, reject) {
                        openpgp.decrypt({
                            message: msg,
                            decryptionKeys: privateKey
                        }).then(function(data) {
                            resolve(data.data);
                        }, reject);
                    });
                };

                let showPassFrm = function() {
                    return $q.resolve().then(function() {
                        $scope.passphrase.model.passphrase = null;
                        $scope.passphrase.model.remember = false;

                        $scope.display = 'passphrase';
                        $scope.passphrase.deferred = $q.defer();
                    });
                }

                let onPassSubmittedOrCanceled = function(privateKey, msg) {
                    return $q(function(resolve, reject) {
                        $scope.passphrase.deferred.promise.then(function () {
                            openpgp.decryptKey({
                                privateKey: privateKey,
                                passphrase: $scope.passphrase.model.passphrase
                            }).then(function(privateKey){
                                decrypt(privateKey, msg).then(resolve, reject);
                            });
                        }, function() {
                            $scope.display = 'decrypt';
                        });
                    });
                };

                e.preventDefault();
                if(form.$valid) {
                    $q(function(resolve, reject) {
                        storage.getPassphrase().then(function (passphrase) {
                            storage.getPgpKeys().then(function (keys) {
                                openpgp.readPrivateKey({armoredKey: keys.privateKey}).then(function (privateKey) {
                                    openpgp.readMessage({armoredMessage: $scope.decrypt.model.msg}).then(function (msg) {

                                        if (privateKey.isDecrypted()) {
                                            decrypt(privateKey, msg).then(resolve, reject);
                                        } else if (passphrase) {
                                            openpgp.decryptKey({
                                                privateKey: privateKey,
                                                passphrase: passphrase
                                            }).then(function (privateKey) {
                                                decrypt(privateKey, msg).then(resolve, reject);
                                            }, function() {
                                                showPassFrm().then(function () {
                                                    onPassSubmittedOrCanceled(privateKey).then(function (data) {
                                                        if ($scope.passphrase.model.remember) {
                                                            storage.setPassphrase($scope.passphrase.model.passphrase);
                                                        }

                                                        resolve(data);
                                                    }, reject);
                                                });
                                            });
                                        } else {
                                            showPassFrm().then(function () {
                                                onPassSubmittedOrCanceled(privateKey).then(function (data) {
                                                    if ($scope.passphrase.model.remember) {
                                                        storage.setPassphrase($scope.passphrase.model.passphrase);
                                                    }

                                                    resolve(data);
                                                }, reject);
                                            });
                                        }
                                    }, reject);
                                }, reject);
                            }, reject);
                        }, reject);
                    }).then(function(data) {
                        $scope.decrypt.decrypted = data;
                    },  function(ex) {
                        pages.showErrorPage(ex.message);
                    });
                }
            }
        }

    }]);

    popup.controller('ErrorController', ['$scope', 'pageControl', function($scope, pages) {
        $scope.pages = pages;
    }]);
})();
