(function(){
    let options = angular.module('options', ['ngSanitize', 'ngBootstrap5', 'services']);

    options.controller('PgpKeysController', ['$scope', '$q', '$bs5Modal', 'storageManager', 'message', function($scope, $q, $bs5Modal, storage, message) {
        let ctrl = this;

        if(location.search && location.search.substring(1) === 'import')
            angular.element(document.querySelector('.bs5-tab:nth-child(2)')).triggerHandler('click');

        storage.getPgpKeys().then(function(pgpKeys) {
            $scope.keys = {
                publicKey: pgpKeys.publicKey,
                privateKey: pgpKeys.privateKey ? pgpKeys.privateKey : null
            }
        });

        $scope.model = {
            publicKey: null,
            privateKey: null
        };

        $scope.submit = function(form, evt) {
            evt.preventDefault();


            if (form.$valid) {
                storage.setPgpKeys($scope.model).then(function () {
                    $scope.keys = angular.copy($scope.model);
                    $scope.model.publicKey = null;
                    $scope.model.privateKey = null;
                }, function (ex) {
                    message(ex.message);
                });
            }
        }

        $scope.importPrivateKey = function(evt) {
            evt.preventDefault();

            let def = $q.defer();
            window.showOpenFilePicker().then(function(fh) {
               fh[0].getFile().then(function(file) {
                  file.text().then(function(content) {
                      def.resolve(content);
                  }, def.reject);
               }, def.reject);
            }, def.reject);

            def.promise.then(function(content) {
                $scope.model.privateKey = content;
            }, function(ex) {
                message(ex.message);
            });
        };

        $scope.importPublicKey = function(evt) {
            evt.preventDefault();

            let def = $q.defer();
            window.showOpenFilePicker().then(function(fh) {
                fh[0].getFile().then(function(file) {
                    file.text().then(function(content) {
                        def.resolve(content);
                    }, def.reject);
                }, def.reject);
            },  def.reject);

            def.promise.then(function(content) {
                $scope.model.publicKey = content;
            }, function(ex) {
                message(ex.message);
            });
        }

        $scope.generateKeys = function() {
            let modal = $bs5Modal({
                templateUrl: 'modals/generate.html',
                centered: true,
                controller: ['$scope', function(scope) {
                    scope.model = {
                        name: null,
                        email: null,
                        usePassphrase: false,
                        passphrase: null,
                        confirmPassphrase: null
                    };

                    scope.dismiss = modal.dismiss;

                    scope.disabled = false;

                    modal.close();

                    scope.submit = function(form, evt) {
                        evt.preventDefault();
                        if(form.$valid) {
                            let def = $q.defer();

                            let storeKeys = function(r) {
                                let keys = {
                                    publicKey: r.publicKey,
                                    privateKey: r.privateKey
                                };

                                storage.setPgpKeys(keys).then(function() { def.resolve(keys); }, def.reject);
                            };

                            scope.disabled = true;
                            if(!scope.model.usePassphrase) {
                                openpgp.generateKey({
                                    type: 'rsa',
                                    rsaBits: 4096,
                                    userIDs: [{name: scope.model.name, email: scope.model.email}],
                                    format: 'armored'
                                }).then(storeKeys, def.reject);
                            }
                            else {
                                openpgp.generateKey({
                                    type: 'rsa',
                                    rsaBits: 4096,
                                    userIDs: [{name: scope.model.name, email: scope.model.email}],
                                    passphrase: scope.model.passphrase,
                                    format: 'armored'
                                }).then(storeKeys, def.reject);
                            }

                            def.promise.then(function(keys) {
                                $scope.keys = keys;
                                $scope.model.publicKey = null;
                                $scope.model.privateKey = null;
                                modal.close();
                            }, function(ex) {
                                scope.disabled = false;
                                console.error(ex);
                                message(ex.message);
                            });
                        }
                    };
                }]
            });
        };
    }]);

    options.controller('RecipientsController', ['$scope', '$q', '$bs5Modal', 'storageManager', 'message', function($scope, $q, $bs5Modal, storage, message) {
        $scope.getSynced = function() {
            storage.getRecipients(null, true).then(function (synced) {
                $scope.synced = synced;
            }, function(ex) {
                message(ex.message);
            });
        };

        $scope.findSynced = function(id) {
            return item => item.id === id;
        };

        $scope.sync = function(recipient, e) {
            e.preventDefault();

            storage.syncRecipient(recipient).then(function() {
                $scope.getSynced();
            }, function(ex) {
                message(ex.message);
            });
        }

        $scope.desync = function(id) {
            storage.desyncRecipient(id).then(function() {
                $scope.getSynced();
            }, function(ex) {
               message(ex.message);
            });
        };

        $scope.remove = function(id) {
            storage.removeRecipient(id).then(function() {
                $scope.search($scope.term);
                $scope.getSynced();
            }, function(ex) {
                message(ex.messsage);
            });
        };

        $scope.oldId = null;

        $scope.page = {
            page: 1,
            pageSize: 10,
            total: 0,
            items: [],
            pageChange: function(pg) {
                $scope.page.page = pg;
                $scope.page.total = $scope.recipients.length
                $scope.page.items = $scope.recipients.slice((pg - 1) * $scope.pageSize, ((pg - 1) * $scope.pageSize) + $scope.pageSize);
            }
        }

        $scope.term = null;

        $scope.search = function(term) {
            storage.getRecipients(term).then(function(recipients) {
                recipients.sort(function(a, b) {
                    return (a.id < b.id ? -1  : (a.id > b.id ? 1 : 0));
                });

                $scope.recipients = recipients;

                $scope.page.page = 1;
                $scope.page.total = recipients.length;
                $scope.page.items = recipients.slice(0, $scope.page.pageSize);

            }, function(ex) {
                message(ex.message);
            });
        };

        $scope.search();

        $scope.model = {
            id:  null,
            publicKey: null
        };

        $scope.add = function(form, e) {
            e.preventDefault();

            if(form.$valid) {
                storage.addRecipient($scope.model).then(function() {
                    $scope.model.id = null;
                    $scope.model.publicKey = null;

                    form.$setUntouched();
                    form.$setPristine();

                    $scope.search($scope.term);
                }, function(ex) {
                    message(ex.message);
                });
            }
        };

        $scope.update = function(form, e) {
            e.preventDefault();

            if(form.$valid) {
                storage.updateRecipient($scope.oldId, $scope.model).then(function() {
                    $scope.model.id = null;
                    $scope.model.publicKey = null;
                    $scope.oldId = null;

                    form.$setUntouched();
                    form.$setPristine();

                    $scope.search($scope.term);
                    message('Successfully updated imported key', false);
                }, function(ex) {
                   message(ex.message);
                });
            }
        };

        $scope.load = function(recipient) {
            $scope.model.id = recipient.id;
            $scope.model.publicKey = recipient.publicKey;
            $scope.oldId = recipient.id;
        };

        $scope.clear = function(form) {
            $scope.model.id = null;
            $scope.model.publicKey = null;
            $scope.oldId = null;

            form.$setUntouched();
            form.$setPristine();
        };

        $scope.importKey = function() {
            $q(function(resolve, reject) {
                window.showOpenFilePicker().then(function(fh) {
                    fh[0].getFile().then(function(file) {
                        file.text().then(function(content) {
                            resolve(content);
                        }, reject)
                    }, reject)
                }, reject)
            }).then(function(content) {
                $scope.model.publicKey = content;
            }, function(ex) {
                if(! ex instanceof DOMException)
                    message(ex.message);
            });
        };
    }]);

    options.service('message', ['$bs5Modal', function($bs5Modal) {
        return function(messages, isError = true) {
            let modal = $bs5Modal({
                templateUrl: 'modals/message.html',
                size: 'lg',
                centered: true,
                controller: ['$scope', function(scope) {
                    scope.msgs = {
                        isArray: angular.isArray(messages),
                        messages: messages
                    };

                    scope.isError = isError;

                    scope.close = modal.close;
                }]
            });

            return modal.result;
        };
    }]);
})();