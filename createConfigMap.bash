CM_STATUS="$(kubectl get cm -n=xingular | grep invoicing-srv-config | wc -l)"

if [ "$CM_STATUS" -eq "1" ]; then
   echo "delete \"invoicing-srv-config\" configmap..."
   kubectl delete cm invoicing-srv-config -n=xingular
fi

echo "create \"invoicing-srv-config\" configmap..."
kubectl create cm invoicing-srv-config -n=xingular --from-file=./cfg/
